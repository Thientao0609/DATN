import bcrypt from 'bcrypt';
import { Role, type User } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError, isPrismaError } from '../../lib/errors.js';
import { signToken } from '../../lib/jwt.js';
import type { loginSchema, registerSchema } from './auth.schema.js';

export const BCRYPT_COST = 10;
// Hash giả để so sánh khi email không tồn tại, tránh lộ email qua thời gian phản hồi.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', BCRYPT_COST);

export interface PublicUser {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: Role;
  doctorId: string | null;
}

export function toPublicUser(user: Pick<User, 'id' | 'email' | 'fullName' | 'phone' | 'role'>, doctorId: string | null = null): PublicUser {
  return { id: user.id, email: user.email, fullName: user.fullName, phone: user.phone, role: user.role, doctorId };
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

/** Đăng ký công khai luôn tạo tài khoản PATIENT. */
export async function register(input: z.infer<typeof registerSchema>) {
  const passwordHash = await hashPassword(input.password);
  try {
    const user = await prisma.user.create({
      data: { email: input.email, passwordHash, fullName: input.fullName, phone: input.phone ?? null, role: Role.PATIENT },
    });
    return { token: signToken({ id: user.id, role: user.role }), user: toPublicUser(user) };
  } catch (err) {
    if (isPrismaError(err, 'P2002')) throw new AppError('CONFLICT', 'Email này đã được sử dụng.');
    throw err;
  }
}

export async function login(input: z.infer<typeof loginSchema>) {
  const user = await prisma.user.findUnique({ where: { email: input.email }, include: { doctor: { select: { id: true } } } });
  const ok = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) throw new AppError('UNAUTHORIZED', 'Email hoặc mật khẩu không đúng.');
  return { token: signToken({ id: user.id, role: user.role }), user: toPublicUser(user, user.doctor?.id ?? null) };
}

export async function getMe(userId: string): Promise<PublicUser> {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { doctor: { select: { id: true } } } });
  if (!user) throw new AppError('UNAUTHORIZED', 'Tài khoản không còn tồn tại, vui lòng đăng nhập lại.');
  return toPublicUser(user, user.doctor?.id ?? null);
}
