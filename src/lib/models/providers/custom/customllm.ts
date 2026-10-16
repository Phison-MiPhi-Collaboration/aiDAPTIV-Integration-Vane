import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { parse } from 'partial-json';
import { repairJson } from '@toolsycc/json-repair';
import OpenAILLM from '../openai/openaiLLM';
import { GenerateObjectInput, GenerateOptions } from '../../types';
 
type CustomLLMConfig = {
  apiKey: string;
  model: string;
  baseURL?: string;
  options?: GenerateOptions;
  offloadFolderName?: string;
};
 
/**
 * OpenAI-compatible LLM that adds extra, non-standard fields to every
 * /chat/completions request body:
 *
 *   cache_prompt: true
 *   offload_folder_name: "<folder>"   (only when configured)
 *
 * and, to keep prompts reproducible so the KV-cache prefix can be reused:
 *
 *   temperature: 0                    (structured and tool-calling requests)
 *   chat_template_kwargs: { enable_thinking: false }   (structured requests)
 *
 * The extra fields are injected at the fetch layer, so generateText,
 * streamText and generateObject all pick them up without duplicating the
 * parent's request-building code.
 */
class CustomLLM extends OpenAILLM {
  constructor(config: CustomLLMConfig) {
    super(config);
 
    const extraBody: Record<string, unknown> = { cache_prompt: true };
    const folder = config.offloadFolderName?.trim();
    if (folder) extraBody.offload_folder_name = folder;
 
    this.openAIClient = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      // A retried request regenerates from scratch on a slow local server;
      // fail once instead of tripling the wait.
      maxRetries: 0,
      fetch: async (url: any, init?: any) => {
        if (
          init &&
          typeof init.body === 'string' &&
          String(url).includes('/chat/completions')
        ) {
          try {
            const body = JSON.parse(init.body);
            const overrides: Record<string, unknown> = {};
 
            // Classifier, suggestions, widgets: their output (e.g. the
            // standalone question) is embedded in later prompts, so sampling
            // noise here breaks the cached prefix of every following call.
           
            if (body.response_format) {
              overrides.temperature = 0;
              overrides.chat_template_kwargs = {
                ...body.chat_template_kwargs,
                enable_thinking: false,
              };
            }
 
            // Researcher: deterministic search queries give the same
            // retrieved chunks, so tool results and the writer context match.
            if (body.tools) overrides.temperature = 0;
 
            init = {
              ...init,
              body: JSON.stringify({ ...body, ...extraBody, ...overrides }),
            };
          } catch {
            // Not JSON, send untouched.
          }
        }
        return fetch(url, init);
      },
    });
  }
 
  /**
   * The parent's generateObject is a non-streaming request: no response
   * headers arrive until generation ends, and Node's fetch aborts after 300 s
   * without headers. Stream instead and validate the final object.
   */
  async generateObject<T>(input: GenerateObjectInput): Promise<T> {
    let received = '';
 
    for await (const delta of this.streamObjectText(input)) {
      received += delta;
    }
 
    try {
      return input.schema.parse(
        JSON.parse(repairJson(received, { extractJson: true }) as string),
      ) as T;
    } catch (err) {
      throw new Error(`Error parsing response from Custom Provider: ${err}`);
    }
  }
 
  /**
   * The parent's streamObject uses the OpenAI Responses API, which most
   * OpenAI-compatible servers don't implement. Use streamed chat completions
   * with a JSON-schema response_format instead.
   */
  async *streamObject<T>(input: GenerateObjectInput): AsyncGenerator<T> {
    let received = '';
 
    for await (const delta of this.streamObjectText(input)) {
      received += delta;
 
      try {
        yield parse(received) as T;
      } catch {
        yield {} as T;
      }
    }
 
    try {
      yield parse(received) as T;
    } catch (err) {
      throw new Error(`Error parsing response from Custom Provider: ${err}`);
    }
  }
 
  /** Streamed chat completion with a JSON-schema response_format. */
  private async *streamObjectText(
    input: GenerateObjectInput,
  ): AsyncGenerator<string> {
    const stream = await this.openAIClient.chat.completions.create({
      model: this.config.model,
      messages: this.convertToOpenAIMessages(input.messages),
      temperature:
        input.options?.temperature ?? this.config.options?.temperature ?? 1.0,
      top_p: input.options?.topP ?? this.config.options?.topP,
      max_completion_tokens:
        input.options?.maxTokens ?? this.config.options?.maxTokens,
      stop: input.options?.stopSequences ?? this.config.options?.stopSequences,
      frequency_penalty:
        input.options?.frequencyPenalty ??
        this.config.options?.frequencyPenalty,
      presence_penalty:
        input.options?.presencePenalty ?? this.config.options?.presencePenalty,
      response_format: zodResponseFormat(input.schema, 'object'),
      stream: true,
    });
 
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) yield delta;
    }
  }
}
 
export default CustomLLM;