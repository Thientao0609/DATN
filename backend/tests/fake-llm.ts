import type { LlmClient, LlmMessage, LlmResponse, LlmToolDefinition } from '../src/modules/chat/llm.js';

/** Model giả lập cho test agent: trả lời theo kịch bản và ghi lại mọi request. */

type ScriptStep = LlmResponse | Error | ((req: { messages: LlmMessage[]; tools?: LlmToolDefinition[] }) => LlmResponse);

export class ScriptedLlm implements LlmClient {
  readonly requests: { messages: LlmMessage[]; tools?: LlmToolDefinition[] }[] = [];
  private readonly steps: ScriptStep[];

  constructor(steps: ScriptStep[]) {
    this.steps = [...steps];
  }

  async chat(req: { messages: LlmMessage[]; tools?: LlmToolDefinition[] }): Promise<LlmResponse> {
    this.requests.push(structuredClone(req));
    const step = this.steps.shift();
    if (!step) throw new Error('Kịch bản model giả lập đã hết bước.');
    if (step instanceof Error) throw step;
    return typeof step === 'function' ? step(req) : step;
  }
}

let callSeq = 0;
export function toolCallStep(name: string, args: Record<string, unknown>): LlmResponse {
  return { content: null, toolCalls: [{ id: `call_${++callSeq}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] };
}

export function textStep(content: string): LlmResponse {
  return { content, toolCalls: [] };
}
