import { AppointmentStatus } from '@prisma/client';
import { z } from 'zod';
import { dateTimeSchema, idSchema, reasonSchema } from '../../lib/validation.js';

export const createAppointmentSchema = z.object({
  doctorId: idSchema,
  startTime: dateTimeSchema,
  reason: reasonSchema,
});

export const rescheduleSchema = z.object({
  startTime: dateTimeSchema,
});

export const listQuerySchema = z.object({
  status: z.enum(AppointmentStatus, { error: 'Trạng thái không hợp lệ.' }).optional(),
});
