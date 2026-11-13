import bcrypt from 'bcrypt';
import { Role, type User } from '@prisma/client';
import { prisma } from '../src/lib/prisma.js';
import { signToken } from '../src/lib/jwt.js';
import { DAY_MS, toVnDateString, vnDateMinutesToUtc, vnDayOfWeek } from '../src/lib/time.js';

export const TEST_PASSWORD = 'Password@123';
// Cost thấp chỉ để test chạy nhanh; code thật dùng cost 10.
const testPasswordHash = bcrypt.hashSync(TEST_PASSWORD, 4);

/** Xóa toàn bộ dữ liệu của database test, theo thứ tự bảng con trước, bảng cha sau. */
export async function resetDb(): Promise<void> {
  // Chốt chặn: không bao giờ dọn database không phải database test.
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('resetDb chỉ chạy trên database có tên kết thúc bằng _test.');
  }
  await prisma.pendingAction.deleteMany();
  await prisma.chatMessage.deleteMany();
  await prisma.chatSession.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.workingSchedule.deleteMany();
  await prisma.doctor.deleteMany();
  await prisma.specialty.deleteMany();
  await prisma.clinicInfo.deleteMany();
  await prisma.user.deleteMany();
}

let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(++seq).toString(36)}`;

export async function createUser(role: Role = Role.PATIENT, overrides: Partial<Pick<User, 'email' | 'fullName'>> = {}) {
  return prisma.user.create({
    data: {
      email: overrides.email ?? `${role.toLowerCase()}-${uniq()}@test.local`,
      passwordHash: testPasswordHash,
      fullName: overrides.fullName ?? `Người dùng ${uniq()}`,
      role,
    },
  });
}

export async function createSpecialty(name = `Khoa ${uniq()}`, symptomHints = 'đau đầu, sốt') {
  return prisma.specialty.create({ data: { name, description: `Mô tả ${name}`, symptomHints } });
}

/** Bác sĩ làm việc thứ 2-7, 08:00-11:30 và 13:30-17:00, khung 30 phút. */
export async function createDoctor(opts: { specialtyId?: string; fullName?: string; fee?: number; slotMinutes?: number } = {}) {
  const specialtyId = opts.specialtyId ?? (await createSpecialty()).id;
  const user = await createUser(Role.DOCTOR, { fullName: opts.fullName ?? `Bác sĩ ${uniq()}` });
  const doctor = await prisma.doctor.create({
    data: { userId: user.id, specialtyId, bio: 'Giới thiệu', fee: opts.fee ?? 200_000, slotMinutes: opts.slotMinutes ?? 30 },
  });
  await prisma.workingSchedule.createMany({
    data: [1, 2, 3, 4, 5, 6].flatMap((dayOfWeek) => [
      { doctorId: doctor.id, dayOfWeek, startTime: '08:00', endTime: '11:30' },
      { doctorId: doctor.id, dayOfWeek, startTime: '13:30', endTime: '17:00' },
    ]),
  });
  return { doctor, user };
}

export function authHeader(user: Pick<User, 'id' | 'role'>): Record<string, string> {
  return { Authorization: `Bearer ${signToken({ id: user.id, role: user.role })}` };
}

/** Ngày làm việc (thứ 2-7) cách hôm nay ít nhất `minDaysAhead` ngày, dạng YYYY-MM-DD. */
export function workingDate(minDaysAhead = 2, now = new Date()): string {
  for (let i = minDaysAhead; i < minDaysAhead + 7; i++) {
    const date = toVnDateString(new Date(now.getTime() + i * DAY_MS));
    if (vnDayOfWeek(date) !== 0) return date;
  }
  throw new Error('Không tìm được ngày làm việc');
}

/** Ngày Chủ nhật sắp tới (bác sĩ không làm việc). */
export function nextSunday(now = new Date()): string {
  for (let i = 1; i <= 7; i++) {
    const date = toVnDateString(new Date(now.getTime() + i * DAY_MS));
    if (vnDayOfWeek(date) === 0) return date;
  }
  throw new Error('Không tìm được Chủ nhật');
}

/** "YYYY-MM-DDTHH:mm:00+07:00" */
export const vnIso = (date: string, time: string) => `${date}T${time}:00+07:00`;

export const vnTime = (date: string, time: string) => {
  const [h, m] = time.split(':').map(Number);
  return vnDateMinutesToUtc(date, h! * 60 + m!);
};
