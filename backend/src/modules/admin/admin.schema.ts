import { AppointmentStatus } from '@prisma/client';
import { z } from 'zod';
import { dateSchema, idSchema, timeSchema } from '../../lib/validation.js';
import { emailSchema, fullNameSchema, passwordSchema, phoneSchema } from '../auth/auth.schema.js';

const text = (label: string, max: number) =>
  z.string({ error: `Vui lòng nhập ${label}.` }).trim().min(1, `Vui lòng nhập ${label}.`).max(max, `${label} tối đa ${max} ký tự.`);

export const specialtySchema = z.object({
  name: text('tên chuyên khoa', 100),
  description: text('mô tả', 2000),
  symptomHints: text('triệu chứng gợi ý', 2000),
});
export const specialtyPatchSchema = specialtySchema.partial();

const doctorFields = {
  fullName: fullNameSchema,
  phone: phoneSchema.optional(),
  specialtyId: idSchema,
  bio: text('giới thiệu', 2000),
  fee: z.number({ error: 'Phí khám phải là số.' }).int('Phí khám phải là số nguyên.').min(0, 'Phí khám không được âm.').max(100_000_000),
  slotMinutes: z.number().int().min(10, 'Thời lượng khung tối thiểu 10 phút.').max(240, 'Thời lượng khung tối đa 240 phút.').optional(),
};

export const createDoctorSchema = z.object({ email: emailSchema, password: passwordSchema, ...doctorFields });
export const updateDoctorSchema = z.object(doctorFields).partial();

export const scheduleSchema = z.object({
  doctorId: idSchema,
  dayOfWeek: z.number({ error: 'Thứ trong tuần phải là số 0-6.' }).int().min(0).max(6),
  startTime: timeSchema,
  endTime: timeSchema,
});
export const schedulePatchSchema = scheduleSchema.omit({ doctorId: true }).partial();
export const scheduleQuerySchema = z.object({ doctorId: idSchema.optional() });

export const clinicInfoSchema = z.object({
  topic: text('chủ đề', 191),
  content: text('nội dung', 5000),
});
export const clinicInfoPatchSchema = clinicInfoSchema.partial();

export const appointmentsQuerySchema = z.object({
  from: dateSchema,
  to: dateSchema,
  doctorId: idSchema.optional(),
  status: z.enum(AppointmentStatus, { error: 'Trạng thái không hợp lệ.' }).optional(),
});
