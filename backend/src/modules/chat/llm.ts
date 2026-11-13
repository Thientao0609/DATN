/**
 * Lớp gọi model duy nhất của dự án. Đổi provider chỉ cần sửa file này.
 * 9Router tương thích chuẩn OpenAI nên dùng SDK `openai` với baseURL tùy chỉnh.
 */
import OpenAI from 'openai';
import type { ChatCompletionFunctionTool, ChatCompletionMessageParam } from 'openai/resources/chat/completions';

export interface LlmToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type LlmMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: LlmToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string };

export interface LlmToolDefinition {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface LlmResponse {
  content: string | null;
  toolCalls: LlmToolCall[];
}

export interface LlmClient {
  chat(request: { messages: LlmMessage[]; tools?: LlmToolDefinition[] }): Promise<LlmResponse>;
}

export interface LlmConfig {
  baseURL: string;
  apiKey: string;
  model: string;
}

/** Timeout cho mỗi lần gọi model. */
export const LLM_TIMEOUT_MS = 30_000;

export function createOpenAiCompatibleClient(config: LlmConfig): LlmClient {
  const client = new OpenAI({ baseURL: config.baseURL, apiKey: config.apiKey, timeout: LLM_TIMEOUT_MS, maxRetries: 0 });
  return {
    async chat({ messages, tools }) {
      const completion = await client.chat.completions.create({
        model: config.model,
        // LlmMessage có cùng cấu trúc với định dạng tin nhắn của OpenAI.
        messages: messages as ChatCompletionMessageParam[],
        ...(tools && tools.length > 0 ? { tools: tools as ChatCompletionFunctionTool[], tool_choice: 'auto' as const } : {}),
      });
      const message = completion.choices[0]?.message;
      if (!message) throw new Error('Model không trả về kết quả.');
      const toolCalls: LlmToolCall[] = (message.tool_calls ?? []).flatMap((tc) =>
        tc.type === 'function' ? [{ id: tc.id, type: 'function' as const, function: { name: tc.function.name, arguments: tc.function.arguments } }] : [],
      );
      return { content: message.content ?? null, toolCalls };
    },
  };
}

let current: LlmClient | null = null;

/** Client đang dùng; mặc định tạo từ biến môi trường LLM_*. */
export async function getLlmClient(): Promise<LlmClient> {
  if (!current) {
    const { env } = await import('../../config/env.js');
    current = createOpenAiCompatibleClient({ baseURL: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY, model: env.LLM_MODEL });
  }
  return current;
}

/** Thay client (dùng cho test với model giả lập). Truyền null để quay về mặc định. */
export function setLlmClient(client: LlmClient | null): void {
  current = client;
}

/** Gọi model với giới hạn thời gian, kể cả khi client không tự áp timeout. */
export async function chatWithTimeout(
  client: LlmClient,
  request: { messages: LlmMessage[]; tools?: LlmToolDefinition[] },
  timeoutMs = LLM_TIMEOUT_MS,
): Promise<LlmResponse> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Model không phản hồi sau ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    return await Promise.race([client.chat(request), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
