import {
  ChatRole,
  CreatedVia,
  PendingActionStatus,
  PendingActionType,
  Prisma,
  type ChatMessage,
  type PendingAction,
} from '@prisma/client';
import { z, ZodError } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError, forbidden, notFound } from '../../lib/errors.js';
import { MINUTE_MS, formatVnDateTime } from '../../lib/time.js';
import { toDate } from '../../lib/validation.js';
import {
  cancelAppointment,
  createAppointment,
  requestReschedule,
  type AppointmentDto,
} from '../appointments/appointments.service.js';
import type { LlmToolCall } from './llm.js';

export const DEFAULT_SESSION_TITLE = 'Cuộc trò chuyện mới';
export const PENDING_ACTION_TTL_MS = 10 * MINUTE_MS;

// ---------------------------------------------------------------------------
// Phiên chat
// ---------------------------------------------------------------------------

export async function createSession(userId: string, title?: string) {
  const session = await prisma.chatSession.create({ data: { userId, title: title?.trim() || DEFAULT_SESSION_TITLE } });
  return { id: session.id, title: session.title, createdAt: session.createdAt.toISOString(), updatedAt: session.updatedAt.toISOString() };
}

export async function listSessions(userId: string) {
  const rows = await prisma.chatSession.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' }, take: 50 });
  return rows.map((s) => ({ id: s.id, title: s.title, createdAt: s.createdAt.toISOString(), updatedAt: s.updatedAt.toISOString() }));
}

/** Phiên phải thuộc về người dùng. */
export async function getOwnedSession(userId: string, sessionId: string) {
  const session = await prisma.chatSession.findUnique({ where: { id: sessionId } });
  if (!session) throw notFound('Không tìm thấy phiên trò chuyện.');
  if (session.userId !== userId) throw forbidden('Bạn chỉ được truy cập phiên trò chuyện của chính mình.');
  return session;
}

/** Đặt tiêu đề phiên theo tin nhắn đầu tiên. */
export async function maybeSetTitleFromMessage(sessionId: string, currentTitle: string, content: string): Promise<void> {
  if (currentTitle !== DEFAULT_SESSION_TITLE) return;
  const title = content.replace(/\s+/g, ' ').trim().slice(0, 60);
  if (title) await prisma.chatSession.update({ where: { id: sessionId }, data: { title } });
}

// ---------------------------------------------------------------------------
// Tin nhắn
// ---------------------------------------------------------------------------

export interface MessageDto {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export function toMessageDto(m: ChatMessage): MessageDto {
  return { id: m.id, role: m.role === ChatRole.user ? 'user' : 'assistant', content: m.content, createdAt: m.createdAt.toISOString() };
}

// Thời điểm tăng dần để thứ tự tin nhắn luôn đúng khi lưu liên tiếp trong cùng mili giây.
let lastMessageTs = 0;
function nextMessageTimestamp(): Date {
  lastMessageTs = Math.max(Date.now(), lastMessageTs + 1);
  return new Date(lastMessageTs);
}

export async function saveMessage(
  sessionId: string,
  data: { role: ChatRole; content: string; toolCalls?: LlmToolCall[]; toolCallId?: string },
): Promise<ChatMessage> {
  const [message] = await prisma.$transaction([
    prisma.chatMessage.create({
      data: {
        sessionId,
        role: data.role,
        content: data.content,
        toolCalls: data.toolCalls ? (data.toolCalls as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        toolCallId: data.toolCallId ?? null,
        createdAt: nextMessageTimestamp(),
      },
    }),
    prisma.chatSession.update({ where: { id: sessionId }, data: { updatedAt: new Date() } }),
  ]);
  return message;
}

/** `limit` tin nhắn gần nhất của phiên, theo thứ tự thời gian. */
export async function loadRecentMessages(sessionId: string, limit: number): Promise<ChatMessage[]> {
  const rows = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
  });
  return rows.reverse();
}

/** Tin nhắn hiển thị cho người dùng (bỏ tin nhắn tool và tin nhắn chỉ chứa lời gọi tool). */
export async function listVisibleMessages(sessionId: string): Promise<MessageDto[]> {
  const rows = await prisma.chatMessage.findMany({
    where: { sessionId, role: { in: [ChatRole.user, ChatRole.assistant] }, NOT: { content: '' } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return rows.map(toMessageDto);
}

// ---------------------------------------------------------------------------
// Thao tác ghi chờ xác nhận
// ---------------------------------------------------------------------------

const createInputSchema = z.object({ doctorId: z.string(), startTime: z.string(), reason: z.string() });
const rescheduleInputSchema = z.object({ appointmentId: z.string(), newStartTime: z.string(), reason: z.string() });
const cancelInputSchema = z.object({ appointmentId: z.string(), reason: z.string() });

export interface PendingActionSummary {
  title: string;
  doctorName: string;
  specialtyName: string;
  /** ISO 8601 theo giờ Việt Nam */
  startTime: string;
  startTimeText: string;
  oldStartTime?: string;
  oldStartTimeText?: string;
  reason: string;
  /** Lý do đổi hoặc hủy lịch người dùng đưa ra. */
  changeReason?: string;
  fee?: number;
}

type PendingInput =
  | { type: typeof PendingActionType.CREATE; input: z.infer<typeof createInputSchema> }
  | { type: typeof PendingActionType.RESCHEDULE; input: z.infer<typeof rescheduleInputSchema> }
  | { type: typeof PendingActionType.CANCEL; input: z.infer<typeof cancelInputSchema> };

const payloadSchema = z.object({ input: z.record(z.string(), z.unknown()), summary: z.custom<PendingActionSummary>() });

export interface PendingActionDto {
  id: string;
  type: PendingActionType;
  status: PendingActionStatus;
  expiresAt: string;
  summary: PendingActionSummary;
}

export function toPendingActionDto(a: PendingAction): PendingActionDto {
  const payload = payloadSchema.parse(a.payload);
  return { id: a.id, type: a.type, status: a.status, expiresAt: a.expiresAt.toISOString(), summary: payload.summary };
}

/** Tạo đề xuất mới; mỗi phiên chỉ có một đề xuất PENDING, đề xuất cũ hết hiệu lực. */
export async function createPendingAction(params: {
  sessionId: string;
  userId: string;
  action: PendingInput;
  summary: PendingActionSummary;
  now?: Date;
}): Promise<PendingActionDto> {
  const now = params.now ?? new Date();
  const created = await prisma.$transaction(async (tx) => {
    await tx.pendingAction.updateMany({
      where: { sessionId: params.sessionId, status: PendingActionStatus.PENDING },
      data: { status: PendingActionStatus.EXPIRED },
    });
    return tx.pendingAction.create({
      data: {
        sessionId: params.sessionId,
        userId: params.userId,
        type: params.action.type,
        payload: { input: params.action.input, summary: params.summary } as unknown as Prisma.InputJsonValue,
        status: PendingActionStatus.PENDING,
        expiresAt: new Date(now.getTime() + PENDING_ACTION_TTL_MS),
      },
    });
  });
  return toPendingActionDto(created);
}

export async function getPendingActionDto(id: string): Promise<PendingActionDto | null> {
  const action = await prisma.pendingAction.findUnique({ where: { id } });
  return action ? toPendingActionDto(action) : null;
}

/** Đề xuất còn hiệu lực của phiên (để khôi phục thẻ xác nhận khi tải lại trang). */
export async function currentPendingAction(sessionId: string, now: Date = new Date()): Promise<PendingActionDto | null> {
  const action = await prisma.pendingAction.findFirst({
    where: { sessionId, status: PendingActionStatus.PENDING, expiresAt: { gt: now } },
    orderBy: { createdAt: 'desc' },
  });
  return action ? toPendingActionDto(action) : null;
}

async function loadOwnedAction(userId: string, actionId: string) {
  const action = await prisma.pendingAction.findUnique({ where: { id: actionId } });
  if (!action) throw notFound('Không tìm thấy thao tác cần xác nhận.');
  if (action.userId !== userId) throw forbidden('Bạn chỉ được xác nhận thao tác của chính mình.');
  return action;
}

function successText(type: PendingActionType, appt: AppointmentDto): string {
  const when = formatVnDateTime(new Date(appt.startTime));
  const who = `bác sĩ ${appt.doctor.fullName} (${appt.doctor.specialty.name})`;
  switch (type) {
    case PendingActionType.CREATE:
      return `Đã đặt lịch thành công với ${who} vào ${when}. Bạn có thể xem trong mục "Lịch hẹn của tôi".`;
    case PendingActionType.RESCHEDULE: {
      const requested = appt.pendingChange ? formatVnDateTime(new Date(appt.pendingChange.startTime)) : when;
      return `Đã gửi yêu cầu đổi lịch với ${who} sang ${requested}. Yêu cầu đang chờ phòng khám xác nhận; trong lúc chờ, lịch cũ lúc ${when} vẫn được giữ.`;
    }
    case PendingActionType.CANCEL:
      return `Đã hủy lịch hẹn với ${who} vào ${when}.`;
  }
}

/**
 * Người dùng bấm Đồng ý: thực hiện thao tác bằng chính các hàm service của REST API.
 * Thành công hay lỗi đều được lưu thành một tin nhắn trong phiên.
 */
export async function confirmPendingAction(userId: string, actionId: string, now: Date = new Date()) {
  const action = await loadOwnedAction(userId, actionId);
  if (action.status !== PendingActionStatus.PENDING) throw new AppError('INVALID_STATUS', 'Thao tác này đã được xử lý trước đó.');
  if (action.expiresAt.getTime() <= now.getTime()) {
    await prisma.pendingAction.updateMany({ where: { id: action.id, status: PendingActionStatus.PENDING }, data: { status: PendingActionStatus.EXPIRED } });
    const message = await saveMessage(action.sessionId, {
      role: ChatRole.assistant,
      content: 'Đề xuất này đã hết hạn sau 10 phút nên chưa được thực hiện. Bạn hãy nhắn lại để mình kiểm tra khung giờ mới nhé.',
    });
    throw new AppError('ACTION_EXPIRED', 'Đề xuất đã hết hạn sau 10 phút. Vui lòng yêu cầu lại.', { message: toMessageDto(message) });
  }

  // Giành quyền xử lý để tránh bấm Đồng ý hai lần.
  const claimed = await prisma.pendingAction.updateMany({
    where: { id: action.id, status: PendingActionStatus.PENDING },
    data: { status: PendingActionStatus.CONFIRMED },
  });
  if (claimed.count === 0) throw new AppError('INVALID_STATUS', 'Thao tác này đã được xử lý trước đó.');

  try {
    const payload = payloadSchema.parse(action.payload);
    let appointment: AppointmentDto;
    switch (action.type) {
      case PendingActionType.CREATE: {
        const input = createInputSchema.parse(payload.input);
        appointment = await createAppointment(
          { patientId: userId, doctorId: input.doctorId, startTime: toDate(input.startTime), reason: input.reason, createdVia: CreatedVia.CHATBOT },
          now,
        );
        break;
      }
      case PendingActionType.RESCHEDULE: {
        const input = rescheduleInputSchema.parse(payload.input);
        appointment = await requestReschedule(
          { patientId: userId, appointmentId: input.appointmentId, newStartTime: toDate(input.newStartTime), reason: input.reason, createdVia: CreatedVia.CHATBOT },
          now,
        );
        break;
      }
      case PendingActionType.CANCEL: {
        const input = cancelInputSchema.parse(payload.input);
        appointment = await cancelAppointment({ patientId: userId, appointmentId: input.appointmentId, reason: input.reason }, now);
        break;
      }
    }
    const message = await saveMessage(action.sessionId, { role: ChatRole.assistant, content: successText(action.type, appointment) });
    const updated = await prisma.pendingAction.findUniqueOrThrow({ where: { id: action.id } });
    return { pendingAction: toPendingActionDto(updated), appointment, message: toMessageDto(message) };
  } catch (err) {
    if (err instanceof AppError || err instanceof ZodError) {
      // Lỗi nghiệp vụ (ví dụ SLOT_TAKEN): đề xuất không còn hợp lệ.
      await prisma.pendingAction.update({ where: { id: action.id }, data: { status: PendingActionStatus.EXPIRED } });
      const reason = err instanceof AppError ? err.message : 'Dữ liệu đề xuất không hợp lệ.';
      const message = await saveMessage(action.sessionId, {
        role: ChatRole.assistant,
        content: `Chưa thực hiện được: ${reason} Bạn muốn mình tìm khung giờ khác không?`,
      });
      if (err instanceof AppError) throw new AppError(err.code, err.message, { message: toMessageDto(message) });
      throw err;
    }
    // Lỗi hệ thống: trả đề xuất về trạng thái chờ để người dùng thử lại.
    await prisma.pendingAction.update({ where: { id: action.id }, data: { status: PendingActionStatus.PENDING } });
    throw err;
  }
}

/** Người dùng bấm Hủy trên thẻ xác nhận. */
export async function rejectPendingAction(userId: string, actionId: string) {
  const action = await loadOwnedAction(userId, actionId);
  const { count } = await prisma.pendingAction.updateMany({
    where: { id: action.id, status: PendingActionStatus.PENDING },
    data: { status: PendingActionStatus.REJECTED },
  });
  if (count === 0) throw new AppError('INVALID_STATUS', 'Thao tác này đã được xử lý trước đó.');
  const message = await saveMessage(action.sessionId, {
    role: ChatRole.assistant,
    content: 'Đã hủy đề xuất, mình chưa thay đổi lịch hẹn nào. Bạn cần mình hỗ trợ gì thêm không?',
  });
  const updated = await prisma.pendingAction.findUniqueOrThrow({ where: { id: action.id } });
  return { pendingAction: toPendingActionDto(updated), message: toMessageDto(message) };
}
