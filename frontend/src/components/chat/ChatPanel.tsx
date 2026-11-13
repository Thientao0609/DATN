import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useApp } from '../../context/AppContext';
import { ApiError, api, errorMessage } from '../../lib/api';
import type { AgentReply, ChatMessage, ChatSession, PendingAction, SlotGroup } from '../../lib/types';
import { Icon } from '../Icon';
import { Markdown } from '../Markdown';
import { ConfirmationCard, type CardState } from './ConfirmationCard';

const MAX_LENGTH = 1000;
const SESSION_REUSE_MS = 12 * 60 * 60 * 1000;
const GREETING = 'Xin chào! Tôi là Trợ lý An Tâm. Bạn có thể mô tả triệu chứng, tôi sẽ gợi ý chuyên khoa, tìm giờ trống và giúp bạn đặt, đổi hoặc hủy lịch.';
const QUICK_REPLIES = [
  { label: 'Đặt lịch khám', text: 'Tôi muốn đặt lịch khám' },
  { label: 'Gợi ý chuyên khoa', text: 'Tôi muốn được gợi ý chuyên khoa theo triệu chứng' },
  { label: 'Giờ làm việc', text: 'Phòng khám làm việc mấy giờ?' },
  { label: 'Phí khám', text: 'Phí khám bao nhiêu?' },
  { label: 'Lịch hẹn của tôi', text: 'Tôi có những lịch hẹn nào?' },
];

interface SlotOptionsState {
  afterMessageId: string;
  groups: SlotGroup[];
}

interface ChatError {
  afterMessageId: string | null;
  message: string;
  suggestForm: boolean;
}

function isEmergency(text: string): boolean {
  // Chỉ coi là cảnh báo cấp cứu khi đoạn mở đầu khuyên gọi 115,
  // không phải câu dặn dò thêm ở cuối một câu trả lời bình thường.
  const firstParagraph = text.trim().split(/\n\s*\n/)[0] ?? '';
  return /\b115\b/.test(firstParagraph.slice(0, 240));
}

export function ChatPanel() {
  const { notifyAppointmentsChanged, takeQueuedMessage, queuedMessage } = useApp();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [cards, setCards] = useState<Record<string, CardState>>({});
  const [slotOptions, setSlotOptions] = useState<SlotOptionsState | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ChatError | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const attachAction = useCallback((messageId: string, action: PendingAction) => {
    setCards((prev) => {
      const next: Record<string, CardState> = {};
      // Mỗi phiên chỉ có một đề xuất chờ: đề xuất cũ hết hiệu lực.
      for (const [id, c] of Object.entries(prev)) next[id] = c.status === 'idle' ? { ...c, status: 'stale' } : c;
      next[messageId] = { action, status: 'idle' };
      return next;
    });
  }, []);

  const loadSession = useCallback(
    async (id: string) => {
      const res = await api.get<{ messages: ChatMessage[]; pendingAction: PendingAction | null }>(`/chat/sessions/${id}/messages`);
      setMessages(res.messages);
      setCards({});
      setSlotOptions(null);
      const lastBot = [...res.messages].reverse().find((m) => m.role === 'assistant');
      if (res.pendingAction && lastBot) attachAction(lastBot.id, res.pendingAction);
    },
    [attachAction],
  );

  const startNewSession = useCallback(async () => {
    const res = await api.post<{ session: ChatSession }>('/chat/sessions', {});
    setSessionId(res.session.id);
    setMessages([]);
    setCards({});
    setSlotOptions(null);
    setError(null);
  }, []);

  // Mở lại phiên gần nhất (trong 12 giờ) hoặc tạo phiên mới.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { sessions } = await api.get<{ sessions: ChatSession[] }>('/chat/sessions');
        const recent = sessions[0];
        if (recent && Date.now() - new Date(recent.updatedAt).getTime() < SESSION_REUSE_MS) {
          if (cancelled) return;
          setSessionId(recent.id);
          await loadSession(recent.id);
        } else if (!cancelled) {
          await startNewSession();
        }
      } catch (err) {
        if (!cancelled) setError({ afterMessageId: null, message: errorMessage(err), suggestForm: false });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadSession, startNewSession]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, cards, slotOptions, sending, error]);

  useEffect(() => {
    if (!sending && !loading) inputRef.current?.focus();
  }, [sending, loading]);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || !sessionId || sending) return;
      const temp: ChatMessage = { id: `temp-${Date.now()}`, role: 'user', content, createdAt: new Date().toISOString() };
      setMessages((m) => [...m, temp]);
      setInput('');
      setSlotOptions(null);
      setError(null);
      setSending(true);
      try {
        const reply = await api.post<AgentReply>(`/chat/sessions/${sessionId}/messages`, { content });
        setMessages((m) => [...m, reply.message]);
        if (reply.pendingAction) attachAction(reply.message.id, reply.pendingAction);
        if (reply.slotOptions.length > 0) setSlotOptions({ afterMessageId: reply.message.id, groups: reply.slotOptions });
      } catch (err) {
        setError({
          afterMessageId: temp.id,
          message: errorMessage(err),
          suggestForm: err instanceof ApiError && err.code === 'LLM_UNAVAILABLE',
        });
      } finally {
        setSending(false);
      }
    },
    [sessionId, sending, attachAction],
  );

  // Tin nhắn gửi kèm khi mở khung chat (ví dụ từ nút trên trang).
  useEffect(() => {
    if (!loading && sessionId && queuedMessage) {
      const m = takeQueuedMessage();
      if (m) void send(m);
    }
  }, [loading, sessionId, queuedMessage, takeQueuedMessage, send]);

  const decide = async (messageId: string, decision: 'confirm' | 'reject') => {
    const card = cards[messageId];
    if (!card || card.status !== 'idle') return;
    setCards((c) => ({ ...c, [messageId]: { ...card, status: 'busy' } }));
    try {
      const res = await api.post<{ message: ChatMessage }>(`/chat/actions/${card.action.id}/${decision}`);
      setCards((c) => ({ ...c, [messageId]: { ...card, status: decision === 'confirm' ? 'done' : 'rejected' } }));
      setMessages((m) => [...m, res.message]);
      if (decision === 'confirm') notifyAppointmentsChanged();
    } catch (err) {
      setCards((c) => ({ ...c, [messageId]: { ...card, status: 'error', note: errorMessage(err) } }));
      // Lỗi nghiệp vụ (ví dụ SLOT_TAKEN) cũng được lưu thành tin nhắn trong phiên.
      const saved = err instanceof ApiError ? (err.details as { message?: ChatMessage } | undefined)?.message : undefined;
      if (saved) setMessages((m) => [...m, saved]);
    }
  };

  const pickSlot = (group: SlotGroup, slot: { time: string }) => {
    void send(`Tôi chọn khung ${slot.time}, ${group.dateText} với bác sĩ ${group.doctorName}.`);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  const errorBlock = error && (
    <div className="chat-error" role="alert">
      <p>{error.message}</p>
      {error.suggestForm && (
        <Link to="/dat-lich" className="btn btn-outline btn-sm">
          Mở form đặt lịch
        </Link>
      )}
    </div>
  );

  return (
    <>
      <div className="chat-body" ref={scrollRef} aria-live="polite" aria-label="Cuộc trò chuyện">
        <div className="chat-row chat-row-bot">
          <div className="chat-bubble chat-bubble-bot">{GREETING}</div>
        </div>
        {messages.length === 0 && !loading && (
          <div className="chat-chips">
            {QUICK_REPLIES.map((q) => (
              <button key={q.label} type="button" className="chip" disabled={sending || !sessionId} onClick={() => void send(q.text)}>
                {q.label}
              </button>
            ))}
          </div>
        )}
        {error && error.afterMessageId === null && errorBlock}
        {messages.map((m) => (
          <div key={m.id} className="chat-entry">
            {m.role === 'user' ? (
              <div className="chat-row chat-row-user">
                <div className="chat-bubble chat-bubble-user">{m.content}</div>
              </div>
            ) : (
              <div className="chat-row chat-row-bot">
                <div className={isEmergency(m.content) ? 'chat-bubble chat-bubble-bot chat-emergency' : 'chat-bubble chat-bubble-bot'}>
                  <Markdown text={m.content} />
                  {isEmergency(m.content) && (
                    <a href="tel:115" className="btn btn-danger-solid btn-sm">
                      <Icon name="phone" size={16} /> Gọi 115 ngay
                    </a>
                  )}
                </div>
              </div>
            )}
            {cards[m.id] && (
              <ConfirmationCard card={cards[m.id]!} onConfirm={() => void decide(m.id, 'confirm')} onReject={() => void decide(m.id, 'reject')} />
            )}
            {slotOptions?.afterMessageId === m.id && (
              <div className="chat-slots">
                {slotOptions.groups.map((g) => (
                  <section key={`${g.doctorId}-${g.date}`} className="slot-group" aria-label={`Giờ trống của bác sĩ ${g.doctorName}`}>
                    <span className="small">
                      <strong>BS. {g.doctorName}</strong> · {g.dateText}
                    </span>
                    <div className="slot-grid">
                      {g.slots.map((s) => (
                        <button key={s.startTime} type="button" className="slot" disabled={sending} onClick={() => pickSlot(g, s)}>
                          {s.time}
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
            {error?.afterMessageId === m.id && errorBlock}
          </div>
        ))}
        {sending && (
          <div className="chat-row chat-row-bot" role="status">
            <div className="chat-bubble chat-bubble-bot chat-typing" aria-label="Trợ lý đang soạn câu trả lời">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
      </div>
      <form className="chat-input" onSubmit={submit}>
        <label htmlFor="chat-input" className="sr-only">
          Nhập tin nhắn cho trợ lý
        </label>
        <input
          id="chat-input"
          ref={inputRef}
          className="input"
          placeholder={sending ? 'Trợ lý đang trả lời…' : 'Nhập câu hỏi của bạn…'}
          value={input}
          maxLength={MAX_LENGTH}
          disabled={sending || loading || !sessionId}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit" className="icon-btn chat-send" aria-label="Gửi tin nhắn" disabled={sending || !input.trim() || !sessionId}>
          <Icon name="send" />
        </button>
      </form>
      {input.length > MAX_LENGTH - 100 && (
        <p className="caption chat-counter">
          {input.length}/{MAX_LENGTH} ký tự
        </p>
      )}
      <NewChatButton onNew={() => void startNewSession()} disabled={sending} />
    </>
  );
}

/** Nút bắt đầu cuộc trò chuyện mới, nằm dưới ô nhập. */
function NewChatButton({ onNew, disabled }: { onNew: () => void; disabled: boolean }) {
  return (
    <button type="button" className="btn btn-sm chat-new" onClick={onNew} disabled={disabled}>
      Cuộc trò chuyện mới
    </button>
  );
}
