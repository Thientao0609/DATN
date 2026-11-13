/**
 * Toàn bộ nghiệp vụ đặt lịch. REST API và tools của agent dùng chung các hàm trong file này.
 */
import { AppointmentStatus, CreatedVia, Prisma, Role } from '@prisma/client';
import { prisma, type Db } from '../../lib/prisma.js';
import { AppError, forbidden, isPrismaError, notFound } from '../../lib/errors.js';
import { reasonSchema } from '../../lib/validation.js';
import {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
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
} satisfies Prisma.AppointmentInclude;

export type AppointmentWithRelations = Prisma.AppointmentGetPayload<{ include: typeof appointmentInclude }>;

export function toAppointmentDto(a: AppointmentWithRelations) {
  return {
    id: a.id,
    startTime: toVnIso(a.startTime),
    endTime: toVnIso(a.endTime),
    reason: a.reason,
    status: a.status,
    createdVia: a.createdVia,
    createdAt: a.createdAt.toISOString(),
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

/** Khung giờ của bác sĩ chưa thuộc lịch hẹn chưa hủy nào. */
async function assertSlotFree(db: Db, doctorId: string, range: SlotRange, excludeAppointmentId?: string): Promise<void> {
  const clash = await db.appointment.findFirst({
    where: {
      doctorId,
      activeKey: 1,
      startTime: { lt: range.end },
      endTime: { gt: range.start },
      ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
    },
    select: { id: true },
  });
  if (clash) throw new AppError('SLOT_TAKEN', MSG_SLOT_TAKEN);
}

/** Bệnh nhân không có lịch chưa hủy trùng giờ và có ít hơn 3 lịch CONFIRMED sắp tới. */
async function assertPatientCanBook(db: Db, patientId: string, range: SlotRange, now: Date, excludeAppointmentId?: string): Promise<void> {
  const exclude = excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {};
  const overlap = await db.appointment.findFirst({
    where: { patientId, activeKey: 1, startTime: { lt: range.end }, endTime: { gt: range.start }, ...exclude },
    select: { id: true },
  });
  if (overlap) throw new AppError('BOOKING_LIMIT', 'Bạn đã có một lịch hẹn khác trùng giờ này.');
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

/** Lịch thuộc về bệnh nhân, đang CONFIRMED và còn trước giờ khám ít nhất 2 giờ. */
async function loadChangeableAppointment(db: Db, patientId: string, appointmentId: string, now: Date) {
  const appt = await db.appointment.findUnique({ where: { id: appointmentId }, include: changeableInclude });
  if (!appt) throw notFound('Không tìm thấy lịch hẹn.');
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

export async function createAppointment(
  input: BookingInput & { createdVia?: CreatedVia },
  now: Date = new Date(),
): Promise<AppointmentDto> {
  const reason = reasonSchema.parse(input.reason);
  return runBookingTx(async (tx) => {
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
    return toAppointmentDto(created);
  });
}

// ---------------------------------------------------------------------------
// Đổi lịch
// ---------------------------------------------------------------------------

export interface RescheduleInput {
  patientId: string;
  appointmentId: string;
  newStartTime: Date;
}

async function validateReschedule(db: Db, input: RescheduleInput, now: Date) {
  const appt = await loadChangeableAppointment(db, input.patientId, input.appointmentId, now);
  if (appt.startTime.getTime() === input.newStartTime.getTime()) {
    throw new AppError('VALIDATION_ERROR', 'Giờ mới trùng với giờ hiện tại của lịch hẹn.');
  }
  const end = await assertBookableSlot(db, { id: appt.doctorId, slotMinutes: appt.doctor.slotMinutes }, input.newStartTime, now);
  const range = { start: input.newStartTime, end };
  await assertSlotFree(db, appt.doctorId, range, appt.id);
  await assertPatientCanBook(db, input.patientId, range, now, appt.id);
  return { appointment: appt, range };
}

/** Kiểm tra đổi lịch mà không ghi gì. */
export async function checkReschedule(input: RescheduleInput, now: Date = new Date()) {
  const { appointment, range } = await validateReschedule(prisma, input, now);
  return { appointment: toAppointmentDto(appointment), newStartTime: range.start, newEndTime: range.end };
}

export async function rescheduleAppointment(input: RescheduleInput, now: Date = new Date()): Promise<AppointmentDto> {
  return runBookingTx(async (tx) => {
    await lockPatient(tx, input.patientId);
    const { appointment, range } = await validateReschedule(tx, input, now);
    const updated = await tx.appointment.update({
      where: { id: appointment.id },
      data: { startTime: range.start, endTime: range.end },
      include: appointmentInclude,
    });
    return toAppointmentDto(updated);
  });
}

// ---------------------------------------------------------------------------
// Hủy lịch
// ---------------------------------------------------------------------------

export interface CancelInput {
  patientId: string;
  appointmentId: string;
}

/** Kiểm tra hủy lịch mà không ghi gì. */
export async function checkCancel(input: CancelInput, now: Date = new Date()): Promise<AppointmentDto> {
  return toAppointmentDto(await loadChangeableAppointment(prisma, input.patientId, input.appointmentId, now));
}

/** Đổi status sang CANCELLED và activeKey về null; khung giờ trở lại trống. */
export async function cancelAppointment(input: CancelInput, now: Date = new Date()): Promise<AppointmentDto> {
  return runBookingTx(async (tx) => {
    await lockPatient(tx, input.patientId);
    const appt = await loadChangeableAppointment(tx, input.patientId, input.appointmentId, now);
    const updated = await tx.appointment.update({
      where: { id: appt.id },
      data: { status: AppointmentStatus.CANCELLED, activeKey: null },
      include: appointmentInclude,
    });
    return toAppointmentDto(updated);
  });
}

// ---------------------------------------------------------------------------
// Hoàn thành (bác sĩ)
// ---------------------------------------------------------------------------

export async function completeAppointment(input: { doctorUserId: string; appointmentId: string }): Promise<AppointmentDto> {
  const doctor = await prisma.doctor.findUnique({ where: { userId: input.doctorUserId }, select: { id: true } });
  if (!doctor) throw forbidden('Tài khoản này chưa có hồ sơ bác sĩ.');
  const appt = await prisma.appointment.findUnique({ where: { id: input.appointmentId }, select: { id: true, doctorId: true } });
  if (!appt) throw notFound('Không tìm thấy lịch hẹn.');
  if (appt.doctorId !== doctor.id) throw forbidden('Bạn chỉ được cập nhật lịch hẹn của chính mình.');
  const { count } = await prisma.appointment.updateMany({
    where: { id: appt.id, status: AppointmentStatus.CONFIRMED },
    data: { status: AppointmentStatus.COMPLETED },
  });
  if (count === 0) throw new AppError('INVALID_STATUS', 'Chỉ đánh dấu đã khám cho lịch hẹn đang ở trạng thái đã xác nhận.');
  const updated = await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id }, include: appointmentInclude });
  return toAppointmentDto(updated);
}

// ---------------------------------------------------------------------------
// Danh sách lịch hẹn
// ---------------------------------------------------------------------------

/** Bệnh nhân thấy lịch của mình; bác sĩ thấy lịch hẹn với mình. */
export async function listMyAppointments(user: { id: string; role: Role }, status?: AppointmentStatus): Promise<AppointmentDto[]> {
  let where: Prisma.AppointmentWhereInput;
  if (user.role === Role.PATIENT) {
    where = { patientId: user.id };
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
  doctor: { select: { id: true, user: { select: { fullName: true } }, specialty: { select: { id: true, name: true } } } },
  patient: { select: { id: true, fullName: true, phone: true } },
} satisfies Prisma.AppointmentSelect;

/** Lịch hẹn của mọi bác sĩ từ ngày `from` đến hết ngày `to` (giờ Việt Nam), tối đa 62 ngày. */
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
    doctor: { id: a.doctor.id, fullName: a.doctor.user.fullName, specialty: a.doctor.specialty },
    patient: a.patient,
  }));
}
