import { AppointmentStatus } from '@prisma/client';
import { z } from 'zod';
import { dateTimeSchema, idSchema, noteSchema, reasonSchema } from '../../lib/validation.js';

export const createAppointmentSchema = z.object({
  doctorId: idSchema,
  startTime: dateTimeSchema,
  reason: reasonSchema,
});

export const rescheduleSchema = z.object({
  startTime: dateTimeSchema,
  changeReason: noteSchema('lý do đổi lịch'),
});

export const cancelSchema = z.object({
  cancelReason: noteSchema('lý do hủy lịch'),
});

export const listQuerySchema = z.object({
  status: z.enum(AppointmentStatus, { error: 'Trạng thái không hợp lệ.' }).optional(),
});
