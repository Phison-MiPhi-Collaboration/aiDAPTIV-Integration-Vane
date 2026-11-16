import { ResearcherOutput, SearchAgentInput } from './types';
import SessionManager from '@/lib/session';
import { classify } from './classifier';
import Researcher from './researcher';
import {
  getWriterPrompt,
  getWriterUserMessage,
} from '@/lib/prompts/search/writer';
import { WidgetExecutor } from './widgets';
import db from '@/lib/db';
import { messages } from '@/lib/db/schema';
import { and, eq, gt } from 'drizzle-orm';
import { TextBlock } from '@/lib/types';
import { getTokenCount } from '@/lib/utils/splitText';
import { isKmEnabled } from '@/lib/km/config';
import { KmContext, getGroupSources, selectGroups } from '@/lib/km/select';

class SearchAgent {
  async searchAsync(session: SessionManager, input: SearchAgentInput) {
    const exists = await db.query.messages.findFirst({
      where: and(
        eq(messages.chatId, input.chatId),
        eq(messages.messageId, input.messageId),
      ),
    });

    if (!exists) {
      await db.insert(messages).values({
        chatId: input.chatId,
        messageId: input.messageId,
        backendId: session.id,
        query: input.followUp,
        createdAt: new Date().toISOString(),
        status: 'answering',
        responseBlocks: [],
      });
    } else {
      await db
        .delete(messages)
        .where(
          and(eq(messages.chatId, input.chatId), gt(messages.id, exists.id)),
        )
        .execute();
      await db
        .update(messages)
        .set({
          status: 'answering',
          backendId: session.id,
          responseBlocks: [],
        })
        .where(
          and(
            eq(messages.chatId, input.chatId),
            eq(messages.messageId, input.messageId),
          ),
        )
        .execute();
    }

    const classification = await classify({
      chatHistory: input.chatHistory,
      enabledSources: input.config.sources,
      query: input.followUp,
      llm: input.config.llm,
    });

    const widgetPromise = WidgetExecutor.executeAll({
      classification,
      chatHistory: input.chatHistory,
      followUp: input.followUp,
      llm: input.config.llm,
    }).then((widgetOutputs) => {
      widgetOutputs.forEach((o) => {
        session.emitBlock({
          id: crypto.randomUUID(),
          type: 'widget',
          data: {
            widgetType: o.type,
            params: o.data,
          },
        });
      });
      return widgetOutputs;
    });

    // KM: pick the document group(s) that go first in the researcher and
    // writer prompts. Runs even when search is skipped, since the writer can
    // answer from the group alone.
    let km: KmContext | null = null;

    if (isKmEnabled() && input.config.fileIds.length > 0) {
      try {
        km = await selectGroups({
          chatId: input.chatId,
          fileIds: input.config.fileIds,
          query: classification.standaloneFollowUp || input.followUp,
          embedding: input.config.embedding,
        });
      } catch (err) {
        console.error('KM: group selection failed, using Vane search:', err);
      }
    }

    let searchPromise: Promise<ResearcherOutput> | null = null;

    if (!classification.classification.skipSearch) {
      const researcher = new Researcher();
      searchPromise = researcher.research(session, {
        chatHistory: input.chatHistory,
        followUp: input.followUp,
        classification: classification,
        config: input.config,
        km: km ?? undefined,
      });
    }

    const [widgetOutputs, searchResults] = await Promise.all([
      widgetPromise,
      searchPromise,
    ]);

    session.emit('data', {
      type: 'researchComplete',
    });

    // KM: the groups become sources after the researcher's, so the UI's
    // source list and the writer's citation numbers line up.
    const groupSources = km ? getGroupSources(km) : [];

    if (groupSources.length > 0) {
      session.emitBlock({
        id: crypto.randomUUID(),
        type: 'source',
        data: groupSources,
      });
    }

    let finalContext =
      '<Query to be answered without searching; Search not made>';

    if (searchResults || groupSources.length > 0) {
      const findings = searchResults?.searchFindings ?? [];

      finalContext = [
        ...findings.map(
          (f, index) =>
            `<result index=${index + 1} title=${f.metadata.title}>${f.content}</result>`,
        ),
        ...groupSources.map(
          (g, index) =>
            `<result index=${findings.length + index + 1} title=${g.metadata.title}>The full text is in the <document_group file="${g.metadata.fileName}"> block at the start of the system prompt.</result>`,
        ),
      ].join('\n');
    }

    const widgetContext = widgetOutputs
      .map((o) => {
        return `<result>${o.llmContext}</result>`;
      })
      .join('\n-------------\n');

    const finalContextWithWidgets = `<search_results note="These are the search results and assistant can cite these">\n${finalContext}\n</search_results>\n<widgets_result noteForAssistant="Its output is already showed to the user, assistant can use this information to answer the query but do not CITE this as a souce">\n${widgetContext}\n</widgets_result>`;

    const writerPrompt = getWriterPrompt(
      input.config.systemInstructions,
      input.config.mode,
      km?.prefix,
    );

    const answerStream = input.config.llm.streamText({
      messages: [
        {
          role: 'system',
          content: writerPrompt,
        },
        ...input.chatHistory,
        {
          role: 'user',
          content: getWriterUserMessage(
            finalContextWithWidgets,
            input.followUp,
          ),
        },
      ],
    });

    let responseBlockId = '';

    for await (const chunk of answerStream) {
      if (!responseBlockId) {
        const block: TextBlock = {
          id: crypto.randomUUID(),
          type: 'text',
          data: chunk.contentChunk,
        };

        session.emitBlock(block);

        responseBlockId = block.id;
      } else {
        const block = session.getBlock(responseBlockId) as TextBlock | null;

        if (!block) {
          continue;
        }

        block.data += chunk.contentChunk;

        session.updateBlock(block.id, [
          {
            op: 'replace',
            path: '/data',
            value: block.data,
          },
        ]);
      }
    }

    session.emit('end', {});

    await db
      .update(messages)
      .set({
        status: 'completed',
        responseBlocks: session.getAllBlocks(),
      })
      .where(
        and(
          eq(messages.chatId, input.chatId),
          eq(messages.messageId, input.messageId),
        ),
      )
      .execute();
  }
}

export default SearchAgent;
