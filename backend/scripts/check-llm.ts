/**
 * Kiểm tra model qua 9Router có hỗ trợ tool calling không (spec mục 7.1).
 * Gửi một request kèm tool giả `get_time` và xác nhận model trả về tool call.
 * Chạy: npm run check:llm
 */
import dotenv from 'dotenv';
import { z } from 'zod';
import { createOpenAiCompatibleClient, type LlmToolDefinition } from '../src/modules/chat/llm.js';

dotenv.config({ quiet: true });

const config = z
  .object({
    LLM_BASE_URL: z.string().trim().min(1, 'Thiếu LLM_BASE_URL'),
    LLM_API_KEY: z.string().trim().min(1, 'Thiếu LLM_API_KEY'),
    LLM_MODEL: z.string().trim().min(1, 'Thiếu LLM_MODEL'),
  })
  .safeParse(process.env);

if (!config.success) {
  console.error(`Chưa cấu hình 9Router trong backend/.env:\n${config.error.issues.map((i) => `  - ${i.message}`).join('\n')}`);
  process.exit(1);
}

const getTimeTool: LlmToolDefinition = {
  type: 'function',
  function: {
    name: 'get_time',
    description: 'Lấy giờ hiện tại theo một múi giờ.',
    parameters: {
      type: 'object',
      properties: { timezone: { type: 'string', description: 'Tên múi giờ IANA, ví dụ Asia/Ho_Chi_Minh' } },
      required: ['timezone'],
    },
  },
};

const client = createOpenAiCompatibleClient({
  baseURL: config.data.LLM_BASE_URL,
  apiKey: config.data.LLM_API_KEY,
  model: config.data.LLM_MODEL,
});

console.info(`Đang kiểm tra model "${config.data.LLM_MODEL}" tại ${config.data.LLM_BASE_URL} ...`);
const started = Date.now();
try {
  const res = await client.chat({
    messages: [
      { role: 'system', content: 'Bạn là trợ lý. Khi cần biết giờ, hãy gọi tool get_time.' },
      { role: 'user', content: 'Bây giờ ở Việt Nam là mấy giờ? Hãy dùng tool get_time với múi giờ Asia/Ho_Chi_Minh.' },
    ],
    tools: [getTimeTool],
  });
  const call = res.toolCalls.find((c) => c.function.name === 'get_time');
  if (!call) {
    console.error(
      `THẤT BẠI: model không trả về tool call (${Date.now() - started} ms).\n` +
        'Model đang cấu hình có thể không hỗ trợ tool calling. Hãy đổi LLM_MODEL sang model hỗ trợ tool calling rồi chạy lại.',
    );
    process.exit(1);
  }
  console.info(`THÀNH CÔNG: model gọi get_time với tham số ${call.function.arguments} (${Date.now() - started} ms).`);
} catch (err) {
  console.error(`THẤT BẠI: không gọi được 9Router (${Date.now() - started} ms): ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
