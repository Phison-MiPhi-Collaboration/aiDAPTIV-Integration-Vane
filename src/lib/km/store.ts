import fs from 'fs';
import path from 'path';
import UploadManager from '@/lib/uploads/manager';

export type KmGroup = {
  id: string;
  block: string;
  tokens: number;
};

export type KmWarmStatus =
  | 'pending'
  | 'warming'
  | 'ready'
  | 'failed'
  | 'skipped';

export type KmWarmState = {
  status: KmWarmStatus;
  providerId?: string;
  modelKey?: string;
  error?: string;
  updatedAt: string;
};

export type KmFileData = {
  groups: KmGroup[];
  warm: KmWarmState;
};

export type KmChunk = {
  content: string;
  embedding: number[];
  groupId?: string;
};

const readContentFile = (fileId: string): any | null => {
  const file = UploadManager.getFile(fileId);

  if (!file || !fs.existsSync(file.contentPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(file.contentPath, 'utf-8'));
  } catch (err) {
    console.error(`KM: failed to read content of file ${fileId}:`, err);
    return null;
  }
};

export const getKmFileData = (fileId: string): KmFileData | null => {
  const content = readContentFile(fileId);
  const km = content?.km;

  if (!km || !Array.isArray(km.groups) || km.groups.length === 0) {
    return null;
  }

  return km as KmFileData;
};

export const getKmChunks = (fileId: string): KmChunk[] => {
  const content = readContentFile(fileId);
  return Array.isArray(content?.chunks) ? content.chunks : [];
};

export const updateKmWarmState = (
  fileId: string,
  warm: Omit<KmWarmState, 'updatedAt'>,
) => {
  const file = UploadManager.getFile(fileId);
  const content = readContentFile(fileId);

  if (!file || !content?.km) {
    return;
  }

  content.km.warm = { ...warm, updatedAt: new Date().toISOString() };
  fs.writeFileSync(file.contentPath, JSON.stringify(content, null, 2));
};

// Which group each chat currently has in its prompt, per file, so follow-up
// questions keep the same cached prefix (the sticky rule in select.ts).
const chatGroupsPath = () =>
  path.join(UploadManager.uploadsDir, 'km_chat_groups.json');

type ChatGroups = Record<string, Record<string, string>>;

const readChatGroups = (): ChatGroups => {
  try {
    return JSON.parse(fs.readFileSync(chatGroupsPath(), 'utf-8'));
  } catch {
    return {};
  }
};

export const getChatGroups = (chatId: string): Record<string, string> =>
  readChatGroups()[chatId] ?? {};

export const setChatGroups = (
  chatId: string,
  groups: Record<string, string>,
) => {
  const all = readChatGroups();
  all[chatId] = groups;
  fs.writeFileSync(chatGroupsPath(), JSON.stringify(all, null, 2));
};
