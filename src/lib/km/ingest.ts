import BaseEmbedding from '@/lib/models/base/embedding';
import { getTokenCount, splitText } from '@/lib/utils/splitText';
import { getKmConfig } from './config';
import { buildGroups } from './grouping';
import { renderGroupBlock } from './prefix';
import type { KmChunk, KmFileData } from './store';

export type KmContent = {
  chunks: KmChunk[];
  km: KmFileData;
};

// Groups first, then chunks inside each group: every chunk belongs to exactly
// one group, so a search hit always points at one cached group. The chunks
// keep Vane's format, so files ingested by KM still work with KM_ENABLED=false.
export const kmIngest = async (
  text: string,
  fileName: string,
  embedding: BaseEmbedding<any>,
): Promise<KmContent> => {
  const config = getKmConfig();
  const budget = Math.floor(
    config.maxTokensPerGroup * (1 - config.tokenMargin),
  );

  const groupTexts = buildGroups(text, budget);

  const groups = groupTexts.map((groupText, i) => {
    const block = renderGroupBlock({
      fileName,
      part: i + 1,
      of: groupTexts.length,
      text: groupText,
    });

    return { id: `g${i + 1}`, block, tokens: getTokenCount(block) };
  });

  const chunkEntries = groupTexts.flatMap((groupText, i) =>
    splitText(groupText, 256, 64).map((content) => ({
      content,
      groupId: groups[i].id,
    })),
  );

  const embeddings = chunkEntries.length
    ? await embedding.embedText(chunkEntries.map((c) => c.content))
    : [];

  if (embeddings.length !== chunkEntries.length) {
    throw new Error('Embeddings and text chunks length mismatch');
  }

  return {
    chunks: chunkEntries.map((c, i) => ({
      content: c.content,
      embedding: embeddings[i],
      groupId: c.groupId,
    })),
    km: {
      groups,
      warm: { status: 'pending', updatedAt: new Date().toISOString() },
    },
  };
};
