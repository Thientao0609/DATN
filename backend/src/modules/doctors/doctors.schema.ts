import { z } from 'zod';
import { dateSchema } from '../../lib/validation.js';

export const searchQuerySchema = z.object({
  specialtyId: z.string().trim().max(64).optional(),
  q: z.string().trim().max(100).optional(),
});

export const slotsQuerySchema = z.object({
  date: dateSchema,
});
