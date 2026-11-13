import { z } from 'zod';

export const emailSchema = z
  .string({ error: 'Vui lòng nhập email.' })
  .trim()
  .toLowerCase()
  .pipe(z.email('Email không hợp lệ.'));

export const passwordSchema = z
  .string({ error: 'Vui lòng nhập mật khẩu.' })
  .min(8, 'Mật khẩu cần ít nhất 8 ký tự.')
  // bcrypt chỉ dùng 72 byte đầu.
  .max(72, 'Mật khẩu tối đa 72 ký tự.');

export const fullNameSchema = z
  .string({ error: 'Vui lòng nhập họ tên.' })
  .trim()
  .min(2, 'Họ tên cần ít nhất 2 ký tự.')
  .max(100, 'Họ tên tối đa 100 ký tự.');

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?\d{9,15}$/, 'Số điện thoại không hợp lệ.');

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: fullNameSchema,
  phone: phoneSchema.optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string({ error: 'Vui lòng nhập mật khẩu.' }).min(1, 'Vui lòng nhập mật khẩu.'),
});
