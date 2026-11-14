/**
 * Toàn bộ nghiệp vụ đặt lịch. REST API và tools của agent dùng chung các hàm trong file này.
 *
 * Đổi lịch cần admin duyệt: yêu cầu đổi lịch tạo một bản ghi giữ chỗ (status PENDING,
 * rescheduleOfId = lịch gốc) ở giờ mới, nên khung giờ mới cũng được unique index bảo vệ.
 * Lịch gốc giữ giờ cũ cho tới khi admin duyệt (cập nhật chính bản ghi gốc sang giờ mới)
 * hoặc từ chối (xóa bản ghi giữ chỗ, gửi email báo cho bệnh nhân).
 */
import { AppointmentStatus, CreatedVia, Prisma, Role } from '@prisma/client';
import { env, frontendOrigins } from '../../config/env.js';
import { prisma, type Db } from '../../lib/prisma.js';
import { AppError, forbidden, isPrismaError, notFound } from '../../lib/errors.js';
import { sendMailSafely } from '../../lib/mailer.js';
import { noteSchema, reasonSchema } from '../../lib/validation.js';
import {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  formatVnDateTime,
  isValidDateString,
  timeToMinutes,
  toVnDateString,
  toVnIso,
  toVnTimeString,
  vnDateMinutesToUtc,
  vnDayOfWeek,
} from '../../lib/time.js';

export const BOOKING_RULES = {
  /** Không nhận khung bắt đầu trong vòng 60 phút tới. */
  minLeadMinutes: 60,
  /** Chỉ đặt trong vòng 30 ngày tới. */
  maxDaysAhead: 30,
  /** Tối đa 3 lịch CONFIRMED sắp tới cho mỗi bệnh nhân. */
  maxUpcomingPerPatient: 3,
  /** Đổi hoặc hủy phải trước giờ khám ít nhất 2 giờ. */
  minChangeHours: 2,
} as const;

const MSG_SLOT_TAKEN = 'Khung giờ này vừa có người đặt. Vui lòng chọn khung giờ khác.';
export const changeReasonSchema = noteSchema('lý do đổi lịch');
export const cancelReasonSchema = noteSchema('lý do hủy lịch');
export const rejectReasonSchema = noteSchema('lý do từ chối');

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

export const appointmentInclude = {
  doctor: {
    select: {
      id: true,
      fee: true,
      user: { select: { fullName: true } },
      specialty: { select: { id: true, name: true } },
    },
  },
  patient: { select: { id: true, fullName: true, phone: true } },
  rescheduleHold: { select: { id: true, startTime: true, endTime: true, changeReason: true, createdAt: true } },
} satisfies Prisma.AppointmentInclude;

export type AppointmentWithRelations = Prisma.AppointmentGetPayload<{ include: typeof appointmentInclude }>;

export function toAppointmentDto(a: AppointmentWithRelations) {
  const hold = a.rescheduleHold;
  return {
    id: a.id,
    startTime: toVnIso(a.startTime),
    endTime: toVnIso(a.endTime),
    reason: a.reason,
    status: a.status,
    createdVia: a.createdVia,
    createdAt: a.createdAt.toISOString(),
    /** Khác null khi đây là bản ghi giữ chỗ của một yêu cầu đổi lịch. */
    rescheduleOfId: a.rescheduleOfId,
    /** Yêu cầu đổi lịch đang chờ admin duyệt. */
    pendingChange: hold
      ? { startTime: toVnIso(hold.startTime), endTime: toVnIso(hold.endTime), reason: hold.changeReason ?? '', requestedAt: hold.createdAt.toISOString() }
      : null,
    /** Lần đổi lịch đã được duyệt gần nhất. */
    changeReason: a.changeReason,
    previousStartTime: a.previousStartTime ? toVnIso(a.previousStartTime) : null,
    /** Lần từ chối đổi lịch gần nhất. */
    changeRejection:
      a.changeRejectedAt && a.rejectedStartTime
        ? { requestedStartTime: toVnIso(a.rejectedStartTime), reason: a.changeRejectReason ?? '', at: a.changeRejectedAt.toISOString() }
        : null,
    cancelReason: a.cancelReason,
    doctor: {
      id: a.doctor.id,
      fullName: a.doctor.user.fullName,
      fee: a.doctor.fee,
      specialty: a.doctor.specialty,
    },
    patient: a.patient,
  };
}

export type AppointmentDto = ReturnType<typeof toAppointmentDto>;

export interface Slot {
  /** ISO 8601 theo giờ Việt Nam, ví dụ 2026-11-14T08:00:00+07:00 */
  startTime: string;
  endTime: string;
  /** HH:mm theo giờ Việt Nam */
  time: string;
}

// ---------------------------------------------------------------------------
// Sinh khung giờ
// ---------------------------------------------------------------------------

interface DoctorSlotInfo {
  id: string;
  slotMinutes: number;
}

interface SlotRange {
  start: Date;
  end: Date;
}

/** Lưới khung giờ làm việc của bác sĩ trong một ngày (giờ Việt Nam), chưa loại khung đã đặt. */
async function generateSlotGrid(db: Db, doctor: DoctorSlotInfo, date: string): Promise<SlotRange[]> {
  const schedules = await db.workingSchedule.findMany({
    where: { doctorId: doctor.id, dayOfWeek: vnDayOfWeek(date) },
    orderBy: { startTime: 'asc' },
  });
  const byStart = new Map<number, SlotRange>();
  for (const s of schedules) {
    const from = timeToMinutes(s.startTime);
    const to = timeToMinutes(s.endTime);
    for (let m = from; m + doctor.slotMinutes <= to; m += doctor.slotMinutes) {
      const start = vnDateMinutesToUtc(date, m);
      byStart.set(start.getTime(), { start, end: new Date(start.getTime() + doctor.slotMinutes * MINUTE_MS) });
    }
  }
  return [...byStart.values()].sort((a, b) => a.start.getTime() - b.start.getTime());
}

function isWithinBookingWindow(start: Date, now: Date): boolean {
  const t = start.getTime();
  return t >= now.getTime() + BOOKING_RULES.minLeadMinutes * MINUTE_MS && t <= now.getTime() + BOOKING_RULES.maxDaysAhead * DAY_MS;
}

const overlaps = (a: SlotRange, b: SlotRange) => a.start < b.end && a.end > b.start;

/** Các khung giờ còn trống của bác sĩ trong ngày `date` (YYYY-MM-DD, giờ Việt Nam). */
export async function getAvailableSlots(doctorId: string, date: string, now: Date = new Date()): Promise<Slot[]> {
  if (!isValidDateString(date)) throw new AppError('VALIDATION_ERROR', 'Ngày không hợp lệ, dùng định dạng YYYY-MM-DD.');
  const doctor = await prisma.doctor.findUnique({ where: { id: doctorId }, select: { id: true, slotMinutes: true } });
  if (!doctor) throw notFound('Không tìm thấy bác sĩ.');

  const grid = (await generateSlotGrid(prisma, doctor, date)).filter((s) => isWithinBookingWindow(s.start, now));
  if (grid.length === 0) return [];

  const dayStart = vnDateMinutesToUtc(date, 0);
  const dayEnd = new Date(dayStart.getTime() + DAY_MS);
  // activeKey = 1 gồm cả bản ghi giữ chỗ của yêu cầu đổi lịch.
  const booked = await prisma.appointment.findMany({
    where: { doctorId, activeKey: 1, startTime: { lt: dayEnd }, endTime: { gt: dayStart } },
    select: { startTime: true, endTime: true },
  });
  const bookedRanges = booked.map((b) => ({ start: b.startTime, end: b.endTime }));

  return grid
    .filter((slot) => !bookedRanges.some((b) => overlaps(slot, b)))
    .map((slot) => ({ startTime: toVnIso(slot.start), endTime: toVnIso(slot.end), time: toVnTimeString(slot.start) }));
}

// ---------------------------------------------------------------------------
// Các kiểm tra dùng chung cho đặt, đổi lịch và đề xuất của agent
// ---------------------------------------------------------------------------

/** startTime phải trùng đúng một khung hợp lệ; trả về giờ kết thúc của khung. */
async function assertBookableSlot(db: Db, doctor: DoctorSlotInfo, start: Date, now: Date): Promise<Date> {
  if (Number.isNaN(start.getTime())) throw new AppError('SLOT_INVALID', 'Thời điểm đặt lịch không hợp lệ.');
  if (start.getTime() < now.getTime() + BOOKING_RULES.minLeadMinutes * MINUTE_MS) {
    throw new AppError('SLOT_INVALID', 'Chỉ đặt được khung giờ bắt đầu sau thời điểm hiện tại ít nhất 60 phút.');
  }
  if (start.getTime() > now.getTime() + BOOKING_RULES.maxDaysAhead * DAY_MS) {
    throw new AppError('SLOT_INVALID', 'Chỉ đặt được lịch trong vòng 30 ngày tới.');
  }
  const grid = await generateSlotGrid(db, doctor, toVnDateString(start));
  const slot = grid.find((s) => s.start.getTime() === start.getTime());
  if (!slot) throw new AppError('SLOT_INVALID', 'Giờ đã chọn không trùng với khung giờ làm việc của bác sĩ.');
  return slot.end;
}

/** Khung giờ của bác sĩ chưa thuộc lịch hẹn chưa hủy nào (kể cả bản ghi giữ chỗ). */
async function assertSlotFree(db: Db, doctorId: string, range: SlotRange, excludeIds: string[] = []): Promise<void> {
  const clash = await db.appointment.findFirst({
    where: {
      doctorId,
      activeKey: 1,
      startTime: { lt: range.end },
      endTime: { gt: range.start },
      ...(excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {}),
    },
    select: { id: true },
  });
  if (clash) throw new AppError('SLOT_TAKEN', MSG_SLOT_TAKEN);
}

/** Bệnh nhân không có lịch chưa hủy trùng giờ và có ít hơn 3 lịch CONFIRMED sắp tới. */
async function assertPatientCanBook(db: Db, patientId: string, range: SlotRange, now: Date, excludeIds: string[] = []): Promise<void> {
  const exclude = excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {};
  const overlap = await db.appointment.findFirst({
    where: { patientId, activeKey: 1, startTime: { lt: range.end }, endTime: { gt: range.start }, ...exclude },
    select: { id: true },
  });
  if (overlap) throw new AppError('BOOKING_LIMIT', 'Bạn đã có một lịch hẹn khác trùng giờ này.');
  // Bản ghi giữ chỗ có status PENDING nên không bị đếm hai lần.
  const upcoming = await db.appointment.count({
    where: { patientId, status: AppointmentStatus.CONFIRMED, startTime: { gt: now }, ...exclude },
  });
  if (upcoming >= BOOKING_RULES.maxUpcomingPerPatient) {
    throw new AppError('BOOKING_LIMIT', 'Bạn đã có 3 lịch hẹn sắp tới. Vui lòng hủy bớt hoặc chờ khám xong rồi đặt thêm.');
  }
}

const changeableInclude = {
  ...appointmentInclude,
  doctor: { select: { ...appointmentInclude.doctor.select, slotMinutes: true } },
} satisfies Prisma.AppointmentInclude;

/** Lịch gốc thuộc về bệnh nhân, đang CONFIRMED và còn trước giờ khám ít nhất 2 giờ. */
async function loadChangeableAppointment(db: Db, patientId: string, appointmentId: string, now: Date) {
  const appt = await db.appointment.findUnique({ where: { id: appointmentId }, include: changeableInclude });
  // Bản ghi giữ chỗ không phải lịch hẹn của người dùng.
  if (!appt || appt.rescheduleOfId) throw notFound('Không tìm thấy lịch hẹn.');
  if (appt.patientId !== patientId) throw forbidden('Bạn chỉ được thay đổi lịch hẹn của chính mình.');
  if (appt.status !== AppointmentStatus.CONFIRMED) {
    throw new AppError('INVALID_STATUS', 'Chỉ đổi hoặc hủy được lịch hẹn đang ở trạng thái đã xác nhận.');
  }
  if (appt.startTime.getTime() - now.getTime() < BOOKING_RULES.minChangeHours * HOUR_MS) {
    throw new AppError('TOO_LATE_TO_CHANGE', 'Chỉ đổi hoặc hủy được lịch trước giờ khám ít nhất 2 giờ.');
  }
  return appt;
}

/** Khóa dòng bệnh nhân để các thao tác đặt lịch của cùng một người chạy tuần tự. */
async function lockPatient(tx: Db, patientId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE id = ${patientId} FOR UPDATE`;
  if (rows.length === 0) throw notFound('Không tìm thấy bệnh nhân.');
}

/**
 * Chạy thao tác ghi lịch trong transaction. Vi phạm unique index (P2002) nghĩa là khung giờ
 * vừa bị người khác đặt; xung đột ghi/deadlock (P2034) được thử lại.
 */
async function runBookingTx<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 10_000,
        timeout: 15_000,
      });
    } catch (err) {
      if (isPrismaError(err, 'P2002')) throw new AppError('SLOT_TAKEN', MSG_SLOT_TAKEN);
      if (isPrismaError(err, 'P2034') && attempt < 3) continue;
      throw err;
    }
  }
}

async function loadDto(db: Db, id: string): Promise<AppointmentDto> {
  return toAppointmentDto(await db.appointment.findUniqueOrThrow({ where: { id }, include: appointmentInclude }));
}

// ---------------------------------------------------------------------------
// Đặt lịch
// ---------------------------------------------------------------------------

export interface BookingInput {
  patientId: string;
  doctorId: string;
  startTime: Date;
  reason: string;
}

/** Kiểm tra một yêu cầu đặt lịch mà không ghi gì (agent dùng trước khi đề xuất). */
export async function checkBooking(input: BookingInput, now: Date = new Date()) {
  const reason = reasonSchema.parse(input.reason);
  const doctor = await prisma.doctor.findUnique({
    where: { id: input.doctorId },
    select: { id: true, slotMinutes: true, fee: true, user: { select: { fullName: true } }, specialty: { select: { name: true } } },
  });
  if (!doctor) throw notFound('Không tìm thấy bác sĩ.');
  const end = await assertBookableSlot(prisma, doctor, input.startTime, now);
  const range = { start: input.startTime, end };
  await assertSlotFree(prisma, doctor.id, range);
  await assertPatientCanBook(prisma, input.patientId, range, now);
  return { doctor, startTime: input.startTime, endTime: end, reason };
}

/** Email xác nhận đặt lịch. Không có lý do khám (dữ liệu sức khỏe). */
function bookingEmail(appt: AppointmentDto, patientName: string) {
  const start = new Date(appt.startTime);
  const minutes = Math.round((new Date(appt.endTime).getTime() - start.getTime()) / MINUTE_MS);
  const via = appt.createdVia === CreatedVia.CHATBOT ? 'trợ lý AI trên website' : 'form đặt lịch trên website';
  const myAppointmentsUrl = `${frontendOrigins[0] ?? ''}/lich-hen`;
  return {
    subject: `[${env.CLINIC_NAME}] Xác nhận lịch khám ${formatVnDateTime(start)}`,
    text: [
      `Chào ${patientName},`,
      '',
      'Lịch khám của bạn đã được đặt thành công:',
      '',
      `- Bác sĩ: ${appt.doctor.fullName}`,
      `- Chuyên khoa: ${appt.doctor.specialty.name}`,
      `- Thời gian: ${formatVnDateTime(start)} (${minutes} phút)`,
      `- Phí khám: ${appt.doctor.fee.toLocaleString('vi-VN')}đ`,
      `- Đặt qua: ${via}`,
      '',
      `Bạn có thể xem, đổi hoặc hủy lịch tại mục "Lịch hẹn của tôi": ${myAppointmentsUrl}`,
      `Đổi hoặc hủy lịch online cần thực hiện trước giờ khám ít nhất ${BOOKING_RULES.minChangeHours} giờ.`,
      '',
      'Nếu bạn không đặt lịch này, vui lòng liên hệ phòng khám.',
      '',
      env.CLINIC_NAME,
    ].join('\n'),
  };
}

/** Đặt lịch (form và trợ lý AI dùng chung), rồi gửi email xác nhận cho bệnh nhân. */
export async function createAppointment(
  input: BookingInput & { createdVia?: CreatedVia },
  now: Date = new Date(),
): Promise<AppointmentDto> {
  const reason = reasonSchema.parse(input.reason);
  const { dto, patient } = await runBookingTx(async (tx) => {
    await lockPatient(tx, input.patientId);
    const doctor = await tx.doctor.findUnique({ where: { id: input.doctorId }, select: { id: true, slotMinutes: true } });
    if (!doctor) throw notFound('Không tìm thấy bác sĩ.');
    const end = await assertBookableSlot(tx, doctor, input.startTime, now);
    const range = { start: input.startTime, end };
    await assertSlotFree(tx, doctor.id, range);
    await assertPatientCanBook(tx, input.patientId, range, now);
    const created = await tx.appointment.create({
      data: {
        patientId: input.patientId,
        doctorId: doctor.id,
        startTime: range.start,
        endTime: range.end,
        reason,
        status: AppointmentStatus.CONFIRMED,
        createdVia: input.createdVia ?? CreatedVia.FORM,
        activeKey: 1,
      },
      include: appointmentInclude,
    });
    const patient = await tx.user.findUniqueOrThrow({ where: { id: input.patientId }, select: { email: true, fullName: true } });
    return { dto: toAppointmentDto(created), patient };
  });
  // Không chờ gửi xong: phản hồi đặt lịch không phải đợi SMTP; lỗi gửi chỉ được ghi log.
  void sendMailSafely({ to: patient.email, ...bookingEmail(dto, patient.fullName) }, 'xác nhận đặt lịch');
  return dto;
}

// ---------------------------------------------------------------------------
// Đổi lịch: bệnh nhân gửi yêu cầu, admin duyệt hoặc từ chối
// ---------------------------------------------------------------------------

export interface RescheduleInput {
  patientId: string;
  appointmentId: string;
  newStartTime: Date;
  reason: string;
  createdVia?: CreatedVia;
}

async function validateReschedule(db: Db, input: RescheduleInput, now: Date) {
  const appt = await loadChangeableAppointment(db, input.patientId, input.appointmentId, now);
  if (appt.startTime.getTime() === input.newStartTime.getTime()) {
    throw new AppError('VALIDATION_ERROR', 'Giờ mới trùng với giờ hiện tại của lịch hẹn.');
  }
  const end = await assertBookableSlot(db, { id: appt.doctorId, slotMinutes: appt.doctor.slotMinutes }, input.newStartTime, now);
  const range = { start: input.newStartTime, end };
  // Bỏ qua chính lịch gốc và yêu cầu đổi lịch cũ của nó (sẽ được thay).
  const exclude = [appt.id, ...(appt.rescheduleHold ? [appt.rescheduleHold.id] : [])];
  await assertSlotFree(db, appt.doctorId, range, exclude);
  await assertPatientCanBook(db, input.patientId, range, now, exclude);
  return { appointment: appt, range };
}

/** Kiểm tra yêu cầu đổi lịch mà không ghi gì. */
export async function checkReschedule(input: RescheduleInput, now: Date = new Date()) {
  const reason = changeReasonSchema.parse(input.reason);
  const { appointment, range } = await validateReschedule(prisma, input, now);
  return { appointment: toAppointmentDto(appointment), newStartTime: range.start, newEndTime: range.end, reason };
}

/**
 * Gửi yêu cầu đổi lịch: giữ chỗ khung giờ mới, lịch gốc vẫn ở giờ cũ cho tới khi admin duyệt.
 * Gửi yêu cầu mới sẽ thay yêu cầu cũ đang chờ.
 */
export async function requestReschedule(input: RescheduleInput, now: Date = new Date()): Promise<AppointmentDto> {
  const reason = changeReasonSchema.parse(input.reason);
  return runBookingTx(async (tx) => {
    await lockPatient(tx, input.patientId);
    const { appointment, range } = await validateReschedule(tx, input, now);
    if (appointment.rescheduleHold) await tx.appointment.delete({ where: { id: appointment.rescheduleHold.id } });
    await tx.appointment.create({
      data: {
        patientId: appointment.patientId,
        doctorId: appointment.doctorId,
        startTime: range.start,
        endTime: range.end,
        reason: appointment.reason,
        status: AppointmentStatus.PENDING,
        createdVia: input.createdVia ?? CreatedVia.FORM,
        activeKey: 1,
        rescheduleOfId: appointment.id,
        changeReason: reason,
      },
    });
    // Yêu cầu mới thay cho lần từ chối trước đó (nếu có).
    await tx.appointment.update({
      where: { id: appointment.id },
      data: { rejectedStartTime: null, changeRejectReason: null, changeRejectedAt: null },
    });
    return loadDto(tx, appointment.id);
  });
}

async function loadPendingRequest(tx: Db, appointmentId: string) {
  const appt = await tx.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      rescheduleHold: true,
      patient: { select: { id: true, email: true, fullName: true } },
      doctor: { select: { user: { select: { fullName: true } }, specialty: { select: { name: true } } } },
    },
  });
  if (!appt || appt.rescheduleOfId) throw notFound('Không tìm thấy lịch hẹn.');
  if (!appt.rescheduleHold) throw new AppError('INVALID_STATUS', 'Lịch này không có yêu cầu đổi lịch đang chờ duyệt.');
  if (appt.status !== AppointmentStatus.CONFIRMED) throw new AppError('INVALID_STATUS', 'Lịch hẹn không còn ở trạng thái đã xác nhận.');
  return { appt, hold: appt.rescheduleHold };
}

/** Admin duyệt: chuyển chính lịch gốc sang giờ mới và bỏ bản ghi giữ chỗ. */
export async function approveReschedule(appointmentId: string, now: Date = new Date()): Promise<AppointmentDto> {
  return runBookingTx(async (tx) => {
    const { appt, hold } = await loadPendingRequest(tx, appointmentId);
    await lockPatient(tx, appt.patientId);
    if (hold.startTime.getTime() <= now.getTime()) {
      throw new AppError('SLOT_INVALID', 'Giờ mới của yêu cầu đã qua nên không duyệt được. Hãy từ chối yêu cầu này.');
    }
    await tx.appointment.delete({ where: { id: hold.id } });
    await tx.appointment.update({
      where: { id: appt.id },
      data: {
        startTime: hold.startTime,
        endTime: hold.endTime,
        previousStartTime: appt.startTime,
        changeReason: hold.changeReason,
        rejectedStartTime: null,
        changeRejectReason: null,
        changeRejectedAt: null,
      },
    });
    return loadDto(tx, appt.id);
  });
}

function rejectionEmail(p: { patientName: string; doctorName: string; specialty: string; current: Date; requested: Date; reason: string }) {
  return {
    subject: `[${env.CLINIC_NAME}] Yêu cầu đổi lịch khám chưa được chấp nhận`,
    text: [
      `Chào ${p.patientName},`,
      '',
      `Yêu cầu đổi lịch khám của bạn với bác sĩ ${p.doctorName} (${p.specialty}) từ ${formatVnDateTime(p.current)} sang ${formatVnDateTime(p.requested)} chưa được phòng khám chấp nhận.`,
      '',
      `Lý do: ${p.reason}`,
      '',
      `Lịch hẹn của bạn vẫn giữ nguyên vào ${formatVnDateTime(p.current)}. Bạn có thể vào mục "Lịch hẹn của tôi" để chọn giờ khác hoặc hủy lịch.`,
      '',
      env.CLINIC_NAME,
    ].join('\n'),
  };
}

/** Admin từ chối: lịch gốc giữ nguyên giờ cũ, ghi lý do và gửi email báo cho bệnh nhân. */
export async function rejectReschedule(appointmentId: string, rejectReason: string, now: Date = new Date()) {
  const reason = rejectReasonSchema.parse(rejectReason);
  const { dto, mail } = await runBookingTx(async (tx) => {
    const { appt, hold } = await loadPendingRequest(tx, appointmentId);
    await lockPatient(tx, appt.patientId);
    await tx.appointment.delete({ where: { id: hold.id } });
    await tx.appointment.update({
      where: { id: appt.id },
      data: { rejectedStartTime: hold.startTime, changeRejectReason: reason, changeRejectedAt: now },
    });
    return {
      dto: await loadDto(tx, appt.id),
      mail: {
        to: appt.patient.email,
        ...rejectionEmail({
          patientName: appt.patient.fullName,
          doctorName: appt.doctor.user.fullName,
          specialty: appt.doctor.specialty.name,
          current: appt.startTime,
          requested: hold.startTime,
          reason,
        }),
      },
    };
  });
  // Gửi email sau khi đã ghi xong; lỗi gửi mail không làm hỏng thao tác từ chối.
  const emailSent = await sendMailSafely(mail, 'từ chối đổi lịch');
  return { appointment: dto, emailSent };
}

/** Các yêu cầu đổi lịch đang chờ duyệt (không có lý do khám — dữ liệu sức khỏe). */
export async function listRescheduleRequests() {
  const holds = await prisma.appointment.findMany({
    where: { rescheduleOfId: { not: null } },
    orderBy: { createdAt: 'asc' },
    select: {
      startTime: true,
      endTime: true,
      changeReason: true,
      createdAt: true,
      createdVia: true,
      rescheduleOf: {
        select: {
          id: true,
          startTime: true,
          endTime: true,
          patient: { select: { id: true, fullName: true, phone: true } },
          doctor: { select: { id: true, user: { select: { fullName: true } }, specialty: { select: { id: true, name: true } } } },
        },
      },
    },
  });
  return holds.flatMap((h) =>
    h.rescheduleOf
      ? [
          {
            appointmentId: h.rescheduleOf.id,
            patient: h.rescheduleOf.patient,
            doctor: { id: h.rescheduleOf.doctor.id, fullName: h.rescheduleOf.doctor.user.fullName, specialty: h.rescheduleOf.doctor.specialty },
            currentStartTime: toVnIso(h.rescheduleOf.startTime),
            requestedStartTime: toVnIso(h.startTime),
            requestedEndTime: toVnIso(h.endTime),
            changeReason: h.changeReason ?? '',
            requestedAt: h.createdAt.toISOString(),
            createdVia: h.createdVia,
          },
        ]
      : [],
  );
}

// ---------------------------------------------------------------------------
// Hủy lịch
// ---------------------------------------------------------------------------

export interface CancelInput {
  patientId: string;
  appointmentId: string;
  reason: string;
}

/** Kiểm tra hủy lịch mà không ghi gì. */
export async function checkCancel(input: CancelInput, now: Date = new Date()) {
  const reason = cancelReasonSchema.parse(input.reason);
  const appointment = toAppointmentDto(await loadChangeableAppointment(prisma, input.patientId, input.appointmentId, now));
  return { appointment, reason };
}

/** Đổi status sang CANCELLED, activeKey về null, ghi lý do hủy; bỏ yêu cầu đổi lịch đang chờ (nếu có). */
export async function cancelAppointment(input: CancelInput, now: Date = new Date()): Promise<AppointmentDto> {
  const reason = cancelReasonSchema.parse(input.reason);
  return runBookingTx(async (tx) => {
    await lockPatient(tx, input.patientId);
    const appt = await loadChangeableAppointment(tx, input.patientId, input.appointmentId, now);
    if (appt.rescheduleHold) await tx.appointment.delete({ where: { id: appt.rescheduleHold.id } });
    await tx.appointment.update({
      where: { id: appt.id },
      data: { status: AppointmentStatus.CANCELLED, activeKey: null, cancelReason: reason },
    });
    return loadDto(tx, appt.id);
  });
}

// ---------------------------------------------------------------------------
// Hoàn thành (bác sĩ)
// ---------------------------------------------------------------------------

export async function completeAppointment(input: { doctorUserId: string; appointmentId: string }): Promise<AppointmentDto> {
  const doctor = await prisma.doctor.findUnique({ where: { userId: input.doctorUserId }, select: { id: true } });
  if (!doctor) throw forbidden('Tài khoản này chưa có hồ sơ bác sĩ.');
  const appt = await prisma.appointment.findUnique({
    where: { id: input.appointmentId },
    select: { id: true, doctorId: true, rescheduleOfId: true, rescheduleHold: { select: { id: true } } },
  });
  if (!appt || appt.rescheduleOfId) throw notFound('Không tìm thấy lịch hẹn.');
  if (appt.doctorId !== doctor.id) throw forbidden('Bạn chỉ được cập nhật lịch hẹn của chính mình.');
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.appointment.updateMany({
      where: { id: appt.id, status: AppointmentStatus.CONFIRMED },
      data: { status: AppointmentStatus.COMPLETED },
    });
    if (count === 0) throw new AppError('INVALID_STATUS', 'Chỉ đánh dấu đã khám cho lịch hẹn đang ở trạng thái đã xác nhận.');
    // Đã khám ở giờ hiện tại thì yêu cầu đổi lịch đang chờ không còn ý nghĩa.
    if (appt.rescheduleHold) await tx.appointment.delete({ where: { id: appt.rescheduleHold.id } });
    return loadDto(tx, appt.id);
  });
}

// ---------------------------------------------------------------------------
// Danh sách lịch hẹn
// ---------------------------------------------------------------------------

/**
 * Bệnh nhân thấy lịch của mình (yêu cầu đổi lịch nằm trong `pendingChange`).
 * Bác sĩ thấy lịch hẹn với mình, gồm cả các khung đang giữ chỗ cho yêu cầu đổi lịch (status PENDING).
 */
export async function listMyAppointments(user: { id: string; role: Role }, status?: AppointmentStatus): Promise<AppointmentDto[]> {
  let where: Prisma.AppointmentWhereInput;
  if (user.role === Role.PATIENT) {
    where = { patientId: user.id, rescheduleOfId: null };
  } else if (user.role === Role.DOCTOR) {
    const doctor = await prisma.doctor.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (!doctor) return [];
    where = { doctorId: doctor.id };
  } else {
    throw forbidden();
  }
  const rows = await prisma.appointment.findMany({
    where: { ...where, ...(status ? { status } : {}) },
    include: appointmentInclude,
    orderBy: { startTime: 'desc' },
  });
  return rows.map(toAppointmentDto);
}

// ---------------------------------------------------------------------------
// Lịch khám cho ADMIN (không đọc lý do khám — dữ liệu sức khỏe)
// ---------------------------------------------------------------------------

const adminAppointmentSelect = {
  id: true,
  startTime: true,
  endTime: true,
  status: true,
  createdVia: true,
  rescheduleOfId: true,
  changeReason: true,
  doctor: { select: { id: true, user: { select: { fullName: true } }, specialty: { select: { id: true, name: true } } } },
  patient: { select: { id: true, fullName: true, phone: true } },
} satisfies Prisma.AppointmentSelect;

/**
 * Lịch hẹn của mọi bác sĩ từ ngày `from` đến hết ngày `to` (giờ Việt Nam), tối đa 62 ngày.
 * Gồm cả khung đang giữ chỗ cho yêu cầu đổi lịch (status PENDING, có rescheduleOfId).
 */
export async function listAppointmentsForAdmin(filter: { from: string; to: string; doctorId?: string; status?: AppointmentStatus }) {
  if (!isValidDateString(filter.from) || !isValidDateString(filter.to)) {
    throw new AppError('VALIDATION_ERROR', 'Ngày không hợp lệ, dùng định dạng YYYY-MM-DD.');
  }
  const start = vnDateMinutesToUtc(filter.from, 0);
  const end = new Date(vnDateMinutesToUtc(filter.to, 0).getTime() + DAY_MS);
  if (end <= start) throw new AppError('VALIDATION_ERROR', 'Ngày kết thúc phải từ ngày bắt đầu trở đi.');
  if (end.getTime() - start.getTime() > 62 * DAY_MS) throw new AppError('VALIDATION_ERROR', 'Chỉ xem tối đa 62 ngày một lần.');
  const rows = await prisma.appointment.findMany({
    where: {
      startTime: { gte: start, lt: end },
      ...(filter.doctorId ? { doctorId: filter.doctorId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    },
    select: adminAppointmentSelect,
    orderBy: { startTime: 'asc' },
  });
  return rows.map((a) => ({
    id: a.id,
    startTime: toVnIso(a.startTime),
    endTime: toVnIso(a.endTime),
    status: a.status,
    createdVia: a.createdVia,
    rescheduleOfId: a.rescheduleOfId,
    changeReason: a.rescheduleOfId ? a.changeReason : null,
    doctor: { id: a.doctor.id, fullName: a.doctor.user.fullName, specialty: a.doctor.specialty },
    patient: a.patient,
  }));
}

// ---------------------------------------------------------------------------
// Lịch khám công khai (trang Đặt lịch): chỉ bác sĩ, chuyên khoa và giờ — không có bệnh nhân
// ---------------------------------------------------------------------------

export type CalendarState = 'BOOKED' | 'HELD' | 'COMPLETED';

/**
 * Các lịch khám chưa hủy trong khoảng ngày (giờ Việt Nam), tối đa 62 ngày.
 * Không trả thông tin bệnh nhân, lý do khám hay mã lịch hẹn.
 */
export async function listPublicCalendar(filter: { from: string; to: string; doctorId?: string; specialtyId?: string }) {
  if (!isValidDateString(filter.from) || !isValidDateString(filter.to)) {
    throw new AppError('VALIDATION_ERROR', 'Ngày không hợp lệ, dùng định dạng YYYY-MM-DD.');
  }
  const start = vnDateMinutesToUtc(filter.from, 0);
  const end = new Date(vnDateMinutesToUtc(filter.to, 0).getTime() + DAY_MS);
  if (end <= start) throw new AppError('VALIDATION_ERROR', 'Ngày kết thúc phải từ ngày bắt đầu trở đi.');
  if (end.getTime() - start.getTime() > 62 * DAY_MS) throw new AppError('VALIDATION_ERROR', 'Chỉ xem tối đa 62 ngày một lần.');
  const rows = await prisma.appointment.findMany({
    where: {
      activeKey: 1,
      startTime: { gte: start, lt: end },
      ...(filter.doctorId ? { doctorId: filter.doctorId } : {}),
      ...(filter.specialtyId ? { doctor: { specialtyId: filter.specialtyId } } : {}),
    },
    select: {
      startTime: true,
      endTime: true,
      status: true,
      doctor: { select: { id: true, user: { select: { fullName: true } }, specialty: { select: { id: true, name: true } } } },
    },
    orderBy: { startTime: 'asc' },
  });
  return rows.map((a) => ({
    startTime: toVnIso(a.startTime),
    endTime: toVnIso(a.endTime),
    state: (a.status === AppointmentStatus.PENDING ? 'HELD' : a.status === AppointmentStatus.COMPLETED ? 'COMPLETED' : 'BOOKED') as CalendarState,
    doctor: { id: a.doctor.id, fullName: a.doctor.user.fullName },
    specialty: a.doctor.specialty,
  }));
}
