/**
 * Tiện ích thời gian theo giờ Việt Nam (Asia/Ho_Chi_Minh).
 * Việt Nam dùng UTC+7 cố định, không có giờ mùa hè, nên tính bằng độ lệch cố định.
 */
export const VN_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const WEEKDAYS_VI = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];

const pad = (n: number) => String(n).padStart(2, '0');

/** Kiểm tra chuỗi YYYY-MM-DD là ngày có thật. */
export function isValidDateString(date: string): boolean {
  const m = DATE_RE.exec(date);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function isValidTimeString(time: string): boolean {
  return TIME_RE.test(time);
}

/** "HH:mm" → số phút từ 00:00. */
export function timeToMinutes(time: string): number {
  const m = TIME_RE.exec(time);
  if (!m) throw new Error(`Giờ không hợp lệ: ${time}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function minutesToTime(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** Thời điểm UTC tương ứng ngày + phút trong ngày theo giờ Việt Nam. */
export function vnDateMinutesToUtc(date: string, minutes: number): Date {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Ngày không hợp lệ: ${date}`);
  const utcMidnight = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(utcMidnight - VN_OFFSET_MS + minutes * MINUTE_MS);
}

/** Thứ trong tuần (0 = Chủ nhật) của một ngày YYYY-MM-DD. */
export function vnDayOfWeek(date: string): number {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Ngày không hợp lệ: ${date}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
}

/** Các thành phần ngày giờ theo giờ Việt Nam của một thời điểm. */
function vnParts(d: Date) {
  const shifted = new Date(d.getTime() + VN_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    weekday: shifted.getUTCDay(),
  };
}

/** YYYY-MM-DD theo giờ Việt Nam. */
export function toVnDateString(d: Date): string {
  const p = vnParts(d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** HH:mm theo giờ Việt Nam. */
export function toVnTimeString(d: Date): string {
  const p = vnParts(d);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Số phút từ 00:00 theo giờ Việt Nam. */
export function vnMinutesOfDay(d: Date): number {
  const p = vnParts(d);
  return p.hour * 60 + p.minute;
}

/** ISO 8601 kèm độ lệch +07:00, ví dụ 2026-11-14T08:00:00+07:00. */
export function toVnIso(d: Date): string {
  const p = vnParts(d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}+07:00`;
}

/** "Thứ bảy, 14/11/2026 08:00" */
export function formatVnDateTime(d: Date): string {
  const p = vnParts(d);
  return `${WEEKDAYS_VI[p.weekday]}, ${pad(p.day)}/${pad(p.month)}/${p.year} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** "Thứ bảy 14/11" */
export function formatVnShortDay(d: Date): string {
  const p = vnParts(d);
  return `${WEEKDAYS_VI[p.weekday]} ${pad(p.day)}/${pad(p.month)}`;
}

const DATETIME_RE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * Đọc thời điểm từ chuỗi ISO 8601. Chuỗi không có múi giờ được hiểu là giờ Việt Nam.
 * Trả về null nếu không hợp lệ.
 */
export function parseDateTimeInput(input: string): Date | null {
  const m = DATETIME_RE.exec(input.trim());
  if (!m) return null;
  const [, date, hh, mm, ss, zone] = m;
  if (!date || !isValidDateString(date)) return null;
  const hour = Number(hh);
  const minute = Number(mm);
  const second = Number(ss ?? '0');
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (!zone) {
    return new Date(vnDateMinutesToUtc(date, hour * 60 + minute).getTime() + second * 1000);
  }
  const d = new Date(input.trim().replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}
