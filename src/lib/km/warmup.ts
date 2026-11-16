import ModelRegistry from '@/lib/models/registry';
import { getKmFileData, updateKmWarmState } from './store';

// Only the aiDAPTIV provider ('custom') sends cache_prompt and
// offload_folder_name, so warming other providers saves nothing.
const WARMABLE_PROVIDER_TYPES = ['custom'];

export type KmChatModel = {
  providerId: string;
  key: string;
};

// One warm-up at a time: the local model server also answers live chats.
let queue: Promise<void> = Promise.resolve();

export const enqueueWarmup = (fileId: string, chatModel: KmChatModel) => {
  queue = queue
    .then(() => warmFile(fileId, chatModel))
    .catch((err) => console.error(`KM: warm-up failed for ${fileId}:`, err));
};

const warmFile = async (fileId: string, chatModel: KmChatModel) => {
  const data = getKmFileData(fileId);
  if (!data) return;

  const base = { providerId: chatModel.providerId, modelKey: chatModel.key };
  const registry = new ModelRegistry();
  const provider = registry.activeProviders.find(
    (p) => p.id === chatModel.providerId,
  );

  if (!provider || !WARMABLE_PROVIDER_TYPES.includes(provider.type)) {
    updateKmWarmState(fileId, { ...base, status: 'skipped' });
    return;
  }

  updateKmWarmState(fileId, { ...base, status: 'warming' });

  try {
    const llm = await registry.loadChatModel(
      chatModel.providerId,
      chatModel.key,
    );

    for (const group of data.groups) {
      // The group block alone as the system message: it is the exact prefix
      // the researcher and writer prompts start with. The short user turn
      // only satisfies templates that require one; it comes after the prefix.
      await llm.generateText({
        messages: [
          { role: 'system', content: group.block },
          { role: 'user', content: '.' },
        ],
        options: { maxTokens: 1 },
      });
    }

    updateKmWarmState(fileId, { ...base, status: 'ready' });
  } catch (err: any) {
    updateKmWarmState(fileId, {
      ...base,
      status: 'failed',
      error: String(err?.message ?? err),
    });
    throw err;
  }
};
