import { UIConfigField } from '@/lib/config/types';
import { ProviderMetadata } from '../../types';
import BaseLLM from '../../base/llm';
import OpenAIProvider from '../openai';
import CustomLLM from './customllm';

// Custom Provider: any OpenAI-compatible endpoint (e.g. an aiDAPTIV+ llama.cpp
// server) that accepts the extra `cache_prompt` and `offload_folder_name`
// request fields for KV-cache reuse. Same pattern as the llmman provider in
// PR #1194: extend an existing provider and override only what differs.

interface CustomConfig {
  apiKey: string;
  baseURL: string;
  offloadFolderName?: string;
}

const providerConfigFields: UIConfigField[] = [
  {
    type: 'password',
    name: 'API Key',
    key: 'apiKey',
    description:
      'API key for the endpoint (leave empty if the server does not need one)',
    required: false,
    placeholder: 'API Key',
    env: 'CUSTOM_API_KEY',
    scope: 'server',
  },
  {
    type: 'string',
    name: 'Base URL',
    key: 'baseURL',
    description: 'Base URL of the OpenAI-compatible endpoint',
    required: true,
    placeholder: process.env.DOCKER
      ? 'http://host.docker.internal:8080/v1'
      : 'http://localhost:8080/v1',
    env: 'CUSTOM_BASE_URL',
    scope: 'server',
  },
  {
    type: 'string',
    name: 'Offload Folder Name',
    key: 'offloadFolderName',
    description:
      'Folder name the backend uses to store and reuse the KV cache (sent as offload_folder_name)',
    required: false,
    placeholder: 'my-doc-cache',
    env: 'CUSTOM_OFFLOAD_FOLDER_NAME',
    scope: 'server',
  },
];

class CustomProvider extends OpenAIProvider {
  constructor(id: string, name: string, config: CustomConfig) {
    super(id, name, config);
  }

  async loadChatModel(key: string): Promise<BaseLLM<any>> {
    const modelList = await this.getModelList();

    const exists = modelList.chat.find((m) => m.key === key);

    if (!exists) {
      throw new Error(
        'Error Loading Custom Provider Chat Model. Invalid Model Selected',
      );
    }

    const config = this.config as CustomConfig;

    return new CustomLLM({
      apiKey: config.apiKey,
      model: key,
      baseURL: config.baseURL,
      offloadFolderName: config.offloadFolderName,
    });
  }

  // loadEmbeddingModel is inherited: embeddings don't need the extra fields.

  static parseAndValidate(raw: any): CustomConfig {
    if (!raw || typeof raw !== 'object')
      throw new Error('Invalid config provided. Expected object');
    if (!raw.baseURL)
      throw new Error('Invalid config provided. Base URL must be provided');

    const folder = raw.offloadFolderName
      ? String(raw.offloadFolderName).trim()
      : '';

    return {
      // The OpenAI SDK rejects an empty key, so use a placeholder for
      // servers that don't check it.
      apiKey: raw.apiKey ? String(raw.apiKey) : 'not-needed',
      baseURL: String(raw.baseURL),
      offloadFolderName: folder || undefined,
    };
  }

  static getProviderConfigFields(): UIConfigField[] {
    return providerConfigFields;
  }

  static getProviderMetadata(): ProviderMetadata {
    return {
      key: 'custom',
      name: 'aiDAPTIV',
    };
  }
}

export default CustomProvider;