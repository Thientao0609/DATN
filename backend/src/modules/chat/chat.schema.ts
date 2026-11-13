import { z } from 'zod';

export const MAX_USER_MESSAGE_LENGTH = 1000;

export const createSessionSchema = z.object({
  title: z.string().trim().max(100, 'Tiêu đề tối đa 100 ký tự.').optional(),
});

export const sendMessageSchema = z.object({
  content: z
    .string({ error: 'Vui lòng nhập tin nhắn.' })
    .trim()
    .min(1, 'Vui lòng nhập tin nhắn.')
    .max(MAX_USER_MESSAGE_LENGTH, 'Tin nhắn tối đa 1.000 ký tự.'),
});
