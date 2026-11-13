import type { WorkingSchedule } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError, notFound } from '../../lib/errors.js';
import { timeToMinutes } from '../../lib/time.js';

export interface ScheduleInput {
  doctorId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export function toScheduleDto(s: WorkingSchedule) {
  return { id: s.id, doctorId: s.doctorId, dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime };
}

/** Giờ kết thúc sau giờ bắt đầu và không chồng lên khoảng làm việc khác cùng ngày của bác sĩ. */
async function validateSchedule(input: ScheduleInput, excludeId?: string): Promise<void> {
  const from = timeToMinutes(input.startTime);
  const to = timeToMinutes(input.endTime);
  if (to <= from) throw new AppError('VALIDATION_ERROR', 'Giờ kết thúc phải sau giờ bắt đầu.');
  const doctor = await prisma.doctor.findUnique({ where: { id: input.doctorId }, select: { slotMinutes: true } });
  if (!doctor) throw notFound('Không tìm thấy bác sĩ.');
  if (to - from < doctor.slotMinutes) {
    throw new AppError('VALIDATION_ERROR', `Khoảng làm việc phải dài ít nhất ${doctor.slotMinutes} phút (một khung khám).`);
  }
  const sameDay = await prisma.workingSchedule.findMany({
    where: { doctorId: input.doctorId, dayOfWeek: input.dayOfWeek, ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
  const clash = sameDay.find((s) => timeToMinutes(s.startTime) < to && timeToMinutes(s.endTime) > from);
  if (clash) {
    throw new AppError('VALIDATION_ERROR', `Khoảng giờ bị chồng lên lịch làm việc ${clash.startTime}-${clash.endTime} cùng ngày.`);
  }
}

export async function listSchedules(doctorId?: string) {
  const rows = await prisma.workingSchedule.findMany({
    where: doctorId ? { doctorId } : {},
    orderBy: [{ doctorId: 'asc' }, { dayOfWeek: 'asc' }, { startTime: 'asc' }],
  });
  return rows.map(toScheduleDto);
}

export async function createSchedule(input: ScheduleInput) {
  await validateSchedule(input);
  return toScheduleDto(await prisma.workingSchedule.create({ data: input }));
}

export async function updateSchedule(id: string, patch: Partial<Omit<ScheduleInput, 'doctorId'>>) {
  const existing = await prisma.workingSchedule.findUnique({ where: { id } });
  if (!existing) throw notFound('Không tìm thấy lịch làm việc.');
  const merged: ScheduleInput = {
    doctorId: existing.doctorId,
    dayOfWeek: patch.dayOfWeek ?? existing.dayOfWeek,
    startTime: patch.startTime ?? existing.startTime,
    endTime: patch.endTime ?? existing.endTime,
  };
  await validateSchedule(merged, id);
  return toScheduleDto(await prisma.workingSchedule.update({ where: { id }, data: merged }));
}

/** Lịch hẹn đã đặt không bị ảnh hưởng; chỉ các khung giờ mới không còn được sinh ra. */
export async function deleteSchedule(id: string): Promise<void> {
  const existing = await prisma.workingSchedule.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw notFound('Không tìm thấy lịch làm việc.');
  await prisma.workingSchedule.delete({ where: { id } });
}
