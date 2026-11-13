/**
 * Vòng lặp tool calling của agent. Model chỉ đọc dữ liệu qua tools và tạo đề xuất ghi;
 * thao tác ghi chỉ được thực hiện khi người dùng bấm xác nhận (chat.service.confirmPendingAction).
 */
import { ChatRole, type ChatMessage } from '@prisma/client';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { chatWithTimeout, getLlmClient, type LlmMessage, type LlmResponse, type LlmToolCall } from './llm.js';
import { buildSystemPrompt } from './prompt.js';
import { executeToolCall, toolDefinitionsForModel, type ToolContext } from './tools.js';
import {
  getPendingActionDto,
  loadRecentMessages,
  saveMessage,
  toMessageDto,
  type MessageDto,
  type PendingActionDto,
} from './chat.service.js';

export const AGENT_LIMITS = {
  /** Tối đa 6 vòng gọi model cho mỗi tin nhắn. */
  maxRounds: 6,
  /** Số tin nhắn gần nhất gửi kèm. */
  historySize: 20,
} as const;

const LLM_UNAVAILABLE_MESSAGE =
  'Trợ lý đang tạm thời không phản hồi. Bạn vui lòng dùng form đặt lịch trên trang để đặt khám, hoặc thử lại sau ít phút.';

function storedToolCalls(m: ChatMessage): LlmToolCall[] {
  return Array.isArray(m.toolCalls) ? (m.toolCalls as unknown as LlmToolCall[]) : [];
}

/**
 * Chuyển tin nhắn đã lưu thành định dạng cho model và bỏ các đoạn không hợp lệ:
 * lịch sử bắt đầu bằng tin nhắn user; tin nhắn assistant gọi tool chỉ giữ khi đủ kết quả tool.
 */
export function toModelHistory(rows: ChatMessage[]): LlmMessage[] {
  const firstUser = rows.findIndex((m) => m.role === ChatRole.user);
  if (firstUser === -1) return [];
  const list = rows.slice(firstUser);
  const out: LlmMessage[] = [];
  for (let i = 0; i < list.length; i++) {
    const m = list[i]!;
    if (m.role === ChatRole.user) {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === ChatRole.assistant) {
      const calls = storedToolCalls(m);
      if (calls.length === 0) {
        if (m.content) out.push({ role: 'assistant', content: m.content });
        continue;
      }
      const results = list.slice(i + 1, i + 1 + calls.length);
      const complete = calls.every((c, k) => results[k]?.role === ChatRole.tool && results[k]?.toolCallId === c.id);
      if (!complete) continue;
      out.push({ role: 'assistant', content: m.content || null, tool_calls: calls });
      results.forEach((r) => out.push({ role: 'tool', content: r.content, tool_call_id: r.toolCallId! }));
      i += calls.length;
    }
    // Tin nhắn tool lẻ (không đi sau lời gọi tool) bị bỏ qua.
  }
  return out;
}

export interface AgentTurnResult {
  message: MessageDto;
  pendingAction: PendingActionDto | null;
}

export async function runAgentTurn(params: {
  sessionId: string;
  user: { id: string; fullName: string };
  content: string;
  now?: Date;
}): Promise<AgentTurnResult> {
  const now = params.now ?? new Date();
  const llm = await getLlmClient();

  // 1. Lưu tin nhắn người dùng.
  await saveMessage(params.sessionId, { role: ChatRole.user, content: params.content });

  // 2. System prompt + 20 tin nhắn gần nhất.
  const history = toModelHistory(await loadRecentMessages(params.sessionId, AGENT_LIMITS.historySize));
  const messages: LlmMessage[] = [
    { role: 'system', content: buildSystemPrompt({ clinicName: env.CLINIC_NAME, userName: params.user.fullName, now }) },
    ...history,
  ];
  const tools = toolDefinitionsForModel();
  const ctx: ToolContext = { userId: params.user.id, sessionId: params.sessionId, now, createdPendingActionId: null };

  for (let round = 1; round <= AGENT_LIMITS.maxRounds; round++) {
    // 3. Gọi model kèm danh sách tools.
    let response: LlmResponse;
    try {
      response = await chatWithTimeout(llm, { messages, tools });
    } catch (err) {
      console.error(`[agent] gọi model thất bại ở vòng ${round}:`, err instanceof Error ? err.message : 'lỗi không xác định');
      throw new AppError('LLM_UNAVAILABLE', LLM_UNAVAILABLE_MESSAGE);
    }

    // 4. Model yêu cầu gọi tool: kiểm tra tham số, thực thi, lưu kết quả rồi quay lại bước 3.
    if (response.toolCalls.length > 0) {
      await saveMessage(params.sessionId, { role: ChatRole.assistant, content: response.content ?? '', toolCalls: response.toolCalls });
      messages.push({ role: 'assistant', content: response.content, tool_calls: response.toolCalls });
      for (const call of response.toolCalls) {
        const result = await executeToolCall(call, ctx);
        const content = JSON.stringify(result.output);
        await saveMessage(params.sessionId, { role: ChatRole.tool, content, toolCallId: call.id });
        messages.push({ role: 'tool', content, tool_call_id: call.id });
      }
      continue;
    }

    // 5. Model trả văn bản: lưu và trả về.
    const text = response.content?.trim() || 'Xin lỗi, mình chưa có câu trả lời phù hợp. Bạn có thể nói rõ hơn không?';
    const saved = await saveMessage(params.sessionId, { role: ChatRole.assistant, content: text });
    return { message: toMessageDto(saved), pendingAction: await pendingActionOf(ctx) };
  }

  const fallback = await saveMessage(params.sessionId, {
    role: ChatRole.assistant,
    content: 'Xin lỗi, yêu cầu này cần quá nhiều bước nên mình chưa xử lý xong. Bạn thử nói ngắn gọn hơn, hoặc dùng form đặt lịch nhé.',
  });
  return { message: toMessageDto(fallback), pendingAction: await pendingActionOf(ctx) };
}

async function pendingActionOf(ctx: ToolContext): Promise<PendingActionDto | null> {
  if (!ctx.createdPendingActionId) return null;
  const action = await getPendingActionDto(ctx.createdPendingActionId);
  return action && action.status === 'PENDING' ? action : null;
}
