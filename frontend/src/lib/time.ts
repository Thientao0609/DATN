/** Ngày giờ theo giờ Việt Nam (Asia/Ho_Chi_Minh), độc lập với múi giờ của máy. */
const TZ = 'Asia/Ho_Chi_Minh';
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
const WEEKDAYS_SHORT = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

const partsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function vnParts(d: Date) {
  const p = Object.fromEntries(partsFormatter.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), hh: p.hour ?? '00', mm: p.minute ?? '00' };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD (giờ Việt Nam) của một thời điểm. */
export function vnDate(input: Date | string): string {
  const p = vnParts(typeof input === 'string' ? new Date(input) : input);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** HH:mm (giờ Việt Nam). */
export function vnTime(input: Date | string): string {
  const p = vnParts(typeof input === 'string' ? new Date(input) : input);
  return `${p.hh}:${p.mm}`;
}

export function todayVn(): string {
  return vnDate(new Date());
}

function utcNoon(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, 12));
}

export function addDays(date: string, days: number): string {
  const t = utcNoon(date);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** 0 = Chủ nhật ... 6 = Thứ bảy */
export function dayOfWeek(date: string): number {
  return utcNoon(date).getUTCDay();
}

/** Thứ hai đầu tuần chứa `date`. */
export function startOfWeek(date: string): string {
  const dow = dayOfWeek(date);
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

export function weekdayName(date: string): string {
  return WEEKDAYS[dayOfWeek(date)]!;
}

export function weekdayShort(date: string): string {
  return WEEKDAYS_SHORT[dayOfWeek(date)]!;
}

/** "14/11" */
export function shortDate(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

/** "Thứ bảy, 14/11/2026" */
export function longDate(date: string): string {
  return `${weekdayName(date)}, ${shortDate(date)}/${date.slice(0, 4)}`;
}

/** "08:00, Thứ bảy 14/11/2026" */
export function formatDateTime(iso: string): string {
  const date = vnDate(iso);
  return `${vnTime(iso)}, ${weekdayName(date)} ${shortDate(date)}/${date.slice(0, 4)}`;
}

/** Thời điểm UTC của ngày + giờ Việt Nam (UTC+7, không có giờ mùa hè). */
export function vnDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+07:00`);
}

export function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h! * 60 + m!;
}

export function timeOf(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isPast(iso: string): boolean {
  return new Date(iso).getTime() < Date.now();
}

export const MS_PER_DAY = DAY_MS;

export function formatMoney(vnd: number): string {
  return `${vnd.toLocaleString('vi-VN')}đ`;
}
