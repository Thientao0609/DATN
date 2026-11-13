/**
 * Tools của agent. Mỗi tool gọi cùng các hàm service mà REST API dùng.
 * userId không bao giờ là tham số: backend lấy từ JWT và truyền qua ToolContext.
 */
import { AppointmentStatus, PendingActionType, Role } from '@prisma/client';
import { z, ZodError } from 'zod';
import { AppError } from '../../lib/errors.js';
import { formatVnDateTime, toVnIso, vnDayOfWeek } from '../../lib/time.js';
import { dateSchema, dateTimeSchema, idSchema, reasonSchema, toDate } from '../../lib/validation.js';
import { listSpecialties } from '../specialties/specialties.service.js';
import { getDoctor, searchDoctors } from '../doctors/doctors.service.js';
import { searchClinicInfo } from '../admin/clinic-info.service.js';
import {
  checkBooking,
  checkCancel,
  checkReschedule,
  getAvailableSlots,
  listMyAppointments,
} from '../appointments/appointments.service.js';
import { createPendingAction } from './chat.service.js';
import type { LlmToolCall, LlmToolDefinition } from './llm.js';

export interface ToolContext {
  userId: string;
  sessionId: string;
  now: Date;
  /** Đề xuất tạo ra trong lượt chat hiện tại. */
  createdPendingActionId: string | null;
  /** Khung giờ trống đã tra trong lượt này, để frontend hiện nút chọn giờ. */
  slotGroups: SlotGroup[];
}

/** Một nhóm khung giờ trống của một bác sĩ trong một ngày. */
export interface SlotGroup {
  doctorId: string;
  doctorName: string;
  specialtyName: string;
  date: string;
  /** "Thứ bảy, 14/11/2026" */
  dateText: string;
  slots: { startTime: string; time: string }[];
}

const MAX_SLOT_GROUPS = 3;

function rememberSlotGroup(ctx: ToolContext, group: SlotGroup): void {
  ctx.slotGroups = ctx.slotGroups.filter((g) => !(g.doctorId === group.doctorId && g.date === group.date));
  ctx.slotGroups.push(group);
  if (ctx.slotGroups.length > MAX_SLOT_GROUPS) ctx.slotGroups.shift();
}

export interface AgentTool {
  name: string;
  description: string;
  kind: 'read' | 'propose';
  parameters: Record<string, unknown>;
  run(rawArgs: unknown, ctx: ToolContext): Promise<unknown>;
}

function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { target: 'draft-7', io: 'input' }) as Record<string, unknown>;
  return rest;
}

function defineTool<S extends z.ZodType>(def: {
  name: string;
  description: string;
  kind: 'read' | 'propose';
  schema: S;
  execute: (args: z.output<S>, ctx: ToolContext) => Promise<unknown>;
}): AgentTool {
  return {
    name: def.name,
    description: def.description,
    kind: def.kind,
    parameters: toJsonSchema(def.schema),
    run: async (rawArgs, ctx) => def.execute(def.schema.parse(rawArgs), ctx),
  };
}

const WEEKDAYS = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
const CONFIRM_NOTE = 'Đề xuất đã được tạo nhưng CHƯA thực hiện. Hãy nhắc người dùng kiểm tra thông tin và bấm nút "Đồng ý" trên thẻ xác nhận (hết hạn sau 10 phút).';

export const agentTools: AgentTool[] = [
  defineTool({
    name: 'list_specialties',
    description: 'Danh sách chuyên khoa của phòng khám kèm triệu chứng thường gặp (symptomHints). Dùng để gợi ý chuyên khoa theo triệu chứng và lấy specialtyId.',
    kind: 'read',
    schema: z.object({}),
    execute: async () => ({ specialties: await listSpecialties() }),
  }),

  defineTool({
    name: 'search_doctors',
    description: 'Tìm bác sĩ theo chuyên khoa (specialtyId lấy từ list_specialties) và/hoặc theo tên. Trả về tối đa 5 bác sĩ: id, tên, khoa, phí khám (VND).',
    kind: 'read',
    schema: z.object({
      specialtyId: z.string().trim().max(64).optional().describe('Mã chuyên khoa từ list_specialties'),
      name: z.string().trim().max(100).optional().describe('Một phần tên bác sĩ'),
    }),
    execute: async (args) => {
      const doctors = await searchDoctors({ specialtyId: args.specialtyId || undefined, q: args.name || undefined, limit: 5 });
      return { doctors: doctors.map((d) => ({ id: d.id, fullName: d.fullName, specialty: d.specialty.name, fee: d.fee })) };
    },
  }),

  defineTool({
    name: 'get_available_slots',
    description: 'Các khung giờ còn trống của một bác sĩ trong một ngày (giờ Việt Nam). Dùng giá trị startTime trả về khi gọi propose_booking hoặc propose_reschedule.',
    kind: 'read',
    schema: z.object({
      doctorId: idSchema.describe('Mã bác sĩ từ search_doctors'),
      date: dateSchema.describe('Ngày khám, định dạng YYYY-MM-DD'),
    }),
    execute: async (args, ctx) => {
      const slots = await getAvailableSlots(args.doctorId, args.date, ctx.now);
      if (slots.length > 0) {
        const doctor = await getDoctor(args.doctorId);
        rememberSlotGroup(ctx, {
          doctorId: doctor.id,
          doctorName: doctor.fullName,
          specialtyName: doctor.specialty.name,
          date: args.date,
          dateText: `${WEEKDAYS[vnDayOfWeek(args.date)]}, ${args.date.slice(8, 10)}/${args.date.slice(5, 7)}/${args.date.slice(0, 4)}`,
          slots: slots.map((s) => ({ startTime: s.startTime, time: s.time })),
        });
      }
      return {
        doctorId: args.doctorId,
        date: args.date,
        weekday: WEEKDAYS[vnDayOfWeek(args.date)],
        slots: slots.map((s) => ({ startTime: s.startTime, time: s.time })),
        ...(slots.length === 0 ? { note: 'Không còn khung trống trong ngày này (bác sĩ không làm việc, đã kín lịch, hoặc ngày nằm ngoài 30 ngày tới).' } : {}),
      };
    },
  }),

  defineTool({
    name: 'get_my_appointments',
    description: 'Lịch hẹn của người đang trò chuyện. Có thể lọc theo trạng thái.',
    kind: 'read',
    schema: z.object({
      status: z.enum(AppointmentStatus).optional().describe('CONFIRMED (sắp tới), COMPLETED (đã khám) hoặc CANCELLED (đã hủy)'),
    }),
    execute: async (args, ctx) => {
      const appointments = await listMyAppointments({ id: ctx.userId, role: Role.PATIENT }, args.status);
      return {
        appointments: appointments.map((a) => ({
          id: a.id,
          doctor: a.doctor.fullName,
          specialty: a.doctor.specialty.name,
          startTime: a.startTime,
          startTimeText: formatVnDateTime(new Date(a.startTime)),
          status: a.status,
          reason: a.reason,
        })),
      };
    },
  }),

  defineTool({
    name: 'lookup_clinic_info',
    description: 'Tra cứu thông tin phòng khám theo từ khóa: giờ làm việc, địa chỉ, bảng giá, quy định hủy lịch, hướng dẫn trước xét nghiệm, bảo hiểm, giấy tờ, gửi xe.',
    kind: 'read',
    schema: z.object({ query: z.string().trim().min(1).max(200).describe('Từ khóa cần tra cứu') }),
    execute: async (args) => searchClinicInfo(args.query),
  }),

  defineTool({
    name: 'propose_booking',
    description: 'Đề xuất đặt lịch khám. Chỉ gọi khi đã có đủ bác sĩ, khung giờ (từ get_available_slots) và lý do khám. Không ghi lịch ngay: người dùng phải bấm Đồng ý.',
    kind: 'propose',
    schema: z.object({
      doctorId: idSchema.describe('Mã bác sĩ'),
      startTime: dateTimeSchema.describe('Giờ bắt đầu, lấy đúng giá trị startTime từ get_available_slots, ví dụ 2026-11-14T08:00:00+07:00'),
      reason: reasonSchema.describe('Lý do khám do người dùng nêu, 5-500 ký tự'),
    }),
    execute: async (args, ctx) => {
      const checked = await checkBooking({ patientId: ctx.userId, doctorId: args.doctorId, startTime: toDate(args.startTime), reason: args.reason }, ctx.now);
      const action = await createPendingAction({
        sessionId: ctx.sessionId,
        userId: ctx.userId,
        now: ctx.now,
        action: { type: PendingActionType.CREATE, input: { doctorId: checked.doctor.id, startTime: toVnIso(checked.startTime), reason: checked.reason } },
        summary: {
          title: 'Đặt lịch khám',
          doctorName: checked.doctor.user.fullName,
          specialtyName: checked.doctor.specialty.name,
          startTime: toVnIso(checked.startTime),
          startTimeText: formatVnDateTime(checked.startTime),
          reason: checked.reason,
          fee: checked.doctor.fee,
        },
      });
      ctx.createdPendingActionId = action.id;
      return {
        pendingActionId: action.id,
        summary: `Đặt lịch với bác sĩ ${action.summary.doctorName} (${action.summary.specialtyName}) vào ${action.summary.startTimeText}. Lý do: ${checked.reason}.`,
        note: CONFIRM_NOTE,
      };
    },
  }),

  defineTool({
    name: 'propose_reschedule',
    description: 'Đề xuất đổi một lịch hẹn (appointmentId từ get_my_appointments) sang khung giờ mới (từ get_available_slots). Người dùng phải bấm Đồng ý.',
    kind: 'propose',
    schema: z.object({
      appointmentId: idSchema.describe('Mã lịch hẹn'),
      newStartTime: dateTimeSchema.describe('Giờ bắt đầu mới, lấy từ get_available_slots'),
    }),
    execute: async (args, ctx) => {
      const checked = await checkReschedule({ patientId: ctx.userId, appointmentId: args.appointmentId, newStartTime: toDate(args.newStartTime) }, ctx.now);
      const action = await createPendingAction({
        sessionId: ctx.sessionId,
        userId: ctx.userId,
        now: ctx.now,
        action: { type: PendingActionType.RESCHEDULE, input: { appointmentId: checked.appointment.id, newStartTime: toVnIso(checked.newStartTime) } },
        summary: {
          title: 'Đổi lịch khám',
          doctorName: checked.appointment.doctor.fullName,
          specialtyName: checked.appointment.doctor.specialty.name,
          startTime: toVnIso(checked.newStartTime),
          startTimeText: formatVnDateTime(checked.newStartTime),
          oldStartTime: checked.appointment.startTime,
          oldStartTimeText: formatVnDateTime(new Date(checked.appointment.startTime)),
          reason: checked.appointment.reason,
        },
      });
      ctx.createdPendingActionId = action.id;
      return {
        pendingActionId: action.id,
        summary: `Đổi lịch với bác sĩ ${action.summary.doctorName} từ ${action.summary.oldStartTimeText} sang ${action.summary.startTimeText}.`,
        note: CONFIRM_NOTE,
      };
    },
  }),

  defineTool({
    name: 'propose_cancel',
    description: 'Đề xuất hủy một lịch hẹn (appointmentId từ get_my_appointments). Người dùng phải bấm Đồng ý.',
    kind: 'propose',
    schema: z.object({ appointmentId: idSchema.describe('Mã lịch hẹn') }),
    execute: async (args, ctx) => {
      const appt = await checkCancel({ patientId: ctx.userId, appointmentId: args.appointmentId }, ctx.now);
      const action = await createPendingAction({
        sessionId: ctx.sessionId,
        userId: ctx.userId,
        now: ctx.now,
        action: { type: PendingActionType.CANCEL, input: { appointmentId: appt.id } },
        summary: {
          title: 'Hủy lịch khám',
          doctorName: appt.doctor.fullName,
          specialtyName: appt.doctor.specialty.name,
          startTime: appt.startTime,
          startTimeText: formatVnDateTime(new Date(appt.startTime)),
          reason: appt.reason,
        },
      });
      ctx.createdPendingActionId = action.id;
      return {
        pendingActionId: action.id,
        summary: `Hủy lịch với bác sĩ ${action.summary.doctorName} vào ${action.summary.startTimeText}.`,
        note: CONFIRM_NOTE,
      };
    },
  }),
];

const toolsByName = new Map(agentTools.map((t) => [t.name, t]));

export function toolDefinitionsForModel(): LlmToolDefinition[] {
  return agentTools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

export interface ToolExecutionResult {
  ok: boolean;
  /** Nội dung trả cho model: kết quả, hoặc { error } khi lỗi. */
  output: unknown;
}

/** Thực thi một lời gọi tool; lỗi được trả về dạng { error } để model giải thích lại cho người dùng. */
export async function executeToolCall(call: LlmToolCall, ctx: ToolContext): Promise<ToolExecutionResult> {
  const tool = toolsByName.get(call.function.name);
  const started = Date.now();
  let result: ToolExecutionResult;
  if (!tool) {
    result = { ok: false, output: { error: `Không có công cụ tên ${call.function.name}.` } };
  } else {
    try {
      const raw: unknown = call.function.arguments?.trim() ? JSON.parse(call.function.arguments) : {};
      result = { ok: true, output: await tool.run(raw, ctx) };
    } catch (err) {
      if (err instanceof SyntaxError) {
        result = { ok: false, output: { error: 'Tham số gửi lên không phải JSON hợp lệ.' } };
      } else if (err instanceof ZodError) {
        const detail = err.issues.map((i) => `${i.path.join('.') || 'tham số'}: ${i.message}`).join('; ');
        result = { ok: false, output: { error: `Tham số không hợp lệ: ${detail}` } };
      } else if (err instanceof AppError) {
        result = { ok: false, output: { error: err.message, code: err.code } };
      } else {
        console.error(`[agent] tool=${call.function.name} lỗi hệ thống:`, err instanceof Error ? err.message : err);
        result = { ok: false, output: { error: 'Lỗi hệ thống khi chạy công cụ. Hãy xin lỗi người dùng và đề nghị dùng form đặt lịch.' } };
      }
    }
  }
  // Chỉ log tên tool, thời gian chạy và kết quả; không log tham số hay nội dung.
  console.info(`[agent] tool=${call.function.name} ms=${Date.now() - started} result=${result.ok ? 'ok' : 'error'}`);
  return result;
}
