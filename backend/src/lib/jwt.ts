import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { env } from '../config/env.js';
import type { AuthUser } from '../types/express.js';

const payloadSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(Role),
});

export function signToken(user: AuthUser): string {
  return jwt.sign({ userId: user.id, role: user.role }, env.JWT_SECRET, { expiresIn: '24h', algorithm: 'HS256' });
}

/** Trả về người dùng trong token, hoặc null nếu token sai hoặc hết hạn. */
export function verifyToken(token: string): AuthUser | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    const parsed = payloadSchema.safeParse(decoded);
    return parsed.success ? { id: parsed.data.userId, role: parsed.data.role } : null;
  } catch {
    return null;
  }
}
