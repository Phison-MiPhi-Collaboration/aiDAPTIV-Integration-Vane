import BaseEmbedding from '@/lib/models/base/embedding';
import UploadManager from '@/lib/uploads/manager';
import computeSimilarity from '@/lib/utils/computeSimilarity';
import { Chunk } from '@/lib/types';
import { getKmConfig } from './config';
import {
  getChatGroups,
  getKmChunks,
  getKmFileData,
  setChatGroups,
} from './store';

export type KmSelectedFile = {
  fileId: string;
  fileName: string;
  groupId: string;
  groupCount: number;
  block: string;
};

export type KmContext = {
  // Group blocks of every KM file, in the chat's file order. Goes first in
  // the researcher and writer system prompts.
  prefix: string;
  files: KmSelectedFile[];
  // Files still searchable with uploads_search: non-KM files and KM files
  // with more than one group.
  searchableFileIds: string[];
  // Chunks of the group already in the prompt, left out of uploads_search.
  excludedGroups: Record<string, string>;
};

// Picks one group per KM file. Like KM: the group of the best-matching chunk.
// Unlike KM: a chat keeps its current group while that group still has a
// chunk in the top k, so follow-up questions keep the same cached prefix.
export const selectGroups = async (input: {
  chatId: string;
  fileIds: string[];
  query: string;
  embedding: BaseEmbedding<any>;
}): Promise<KmContext | null> => {
  const kmFiles = input.fileIds
    .map((fileId) => ({
      fileId,
      record: UploadManager.getFile(fileId),
      data: getKmFileData(fileId),
    }))
    .filter((f) => f.record && f.data);

  if (kmFiles.length === 0) {
    return null;
  }

  const { stickyTopK } = getKmConfig();
  const previous = getChatGroups(input.chatId);
  const needsSearch = kmFiles.some((f) => f.data!.groups.length > 1);
  const [queryEmbedding] = needsSearch
    ? await input.embedding.embedText([input.query])
    : [];

  const files: KmSelectedFile[] = kmFiles.map(({ fileId, record, data }) => {
    const groups = data!.groups;
    let groupId = groups[0].id;

    if (groups.length > 1) {
      const ranked = getKmChunks(fileId)
        .filter((c) => c.groupId)
        .map((c) => ({
          groupId: c.groupId!,
          score: computeSimilarity(queryEmbedding, c.embedding),
        }))
        .sort((a, b) => b.score - a.score);

      const current = previous[fileId];
      const topGroups = new Set(
        ranked.slice(0, stickyTopK).map((r) => r.groupId),
      );
      const currentIsValid = groups.some((g) => g.id === current);

      if (current && currentIsValid && topGroups.has(current)) {
        groupId = current;
      } else if (ranked.length > 0) {
        groupId = ranked[0].groupId;
      }
    }

    const group = groups.find((g) => g.id === groupId) ?? groups[0];

    return {
      fileId,
      fileName: record!.name,
      groupId: group.id,
      groupCount: groups.length,
      block: group.block,
    };
  });

  setChatGroups(
    input.chatId,
    Object.fromEntries(files.map((f) => [f.fileId, f.groupId])),
  );

  const singleGroupFileIds = new Set(
    files.filter((f) => f.groupCount === 1).map((f) => f.fileId),
  );

  return {
    prefix: files.map((f) => f.block).join(''),
    files,
    searchableFileIds: input.fileIds.filter(
      (id) => !singleGroupFileIds.has(id),
    ),
    excludedGroups: Object.fromEntries(
      files.filter((f) => f.groupCount > 1).map((f) => [f.fileId, f.groupId]),
    ),
  };
};

// One source entry per group in the prompt, so the writer can cite it and
// the UI lists it. The content is a short excerpt; the full text is already
// in the system prompt.
export const getGroupSources = (context: KmContext): Chunk[] =>
  context.files.map((f) => ({
    content: excerpt(f.block),
    metadata: {
      title:
        f.groupCount > 1
          ? `${f.fileName} (part ${f.groupId.slice(1)} of ${f.groupCount})`
          : f.fileName,
      fileName: f.fileName,
      fileId: f.fileId,
      url: `file_id://${f.fileId}#${f.groupId}`,
    },
  }));

const excerpt = (block: string) => {
  const body = block
    .replace(/^<document_group[^>]*>\n/, '')
    .replace(/\n<\/document_group>\n$/, '');
  return body.length > 500 ? `${body.slice(0, 500)}…` : body;
};
