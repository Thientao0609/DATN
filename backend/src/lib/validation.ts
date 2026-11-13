import { z } from 'zod';
import { isValidDateString, isValidTimeString, parseDateTimeInput } from './time.js';

export const idSchema = z.string().trim().min(1, 'Thiếu mã định danh.').max(64, 'Mã định danh không hợp lệ.');

export const dateSchema = z
  .string({ error: 'Thiếu ngày (YYYY-MM-DD).' })
  .trim()
  .refine(isValidDateString, 'Ngày không hợp lệ, dùng định dạng YYYY-MM-DD.');

export const timeSchema = z.string().trim().refine(isValidTimeString, 'Giờ không hợp lệ, dùng định dạng HH:mm.');

/** Thời điểm ISO 8601; chuỗi không có múi giờ được hiểu là giờ Việt Nam. */
export const dateTimeSchema = z
  .string({ error: 'Thiếu thời điểm.' })
  .trim()
  .refine((s) => parseDateTimeInput(s) !== null, 'Thời điểm không hợp lệ, dùng định dạng ISO 8601, ví dụ 2026-11-14T08:00:00+07:00.');

/** Chuyển chuỗi đã qua dateTimeSchema thành Date. */
export function toDate(value: string): Date {
  const d = parseDateTimeInput(value);
  if (!d) throw new Error(`Thời điểm không hợp lệ: ${value}`);
  return d;
}

export const reasonSchema = z
  .string({ error: 'Vui lòng nhập lý do khám.' })
  .trim()
  .min(5, 'Lý do khám cần ít nhất 5 ký tự.')
  .max(500, 'Lý do khám tối đa 500 ký tự.');

export const idParamsSchema = z.object({ id: idSchema });

/** Ô ghi chú bắt buộc 5–500 ký tự (lý do đổi lịch, hủy lịch, từ chối). */
export const noteSchema = (label: string) =>
  z
    .string({ error: `Vui lòng nhập ${label}.` })
    .trim()
    .min(5, `Vui lòng nhập ${label} (ít nhất 5 ký tự).`)
    .max(500, `${label.charAt(0).toUpperCase()}${label.slice(1)} tối đa 500 ký tự.`);
