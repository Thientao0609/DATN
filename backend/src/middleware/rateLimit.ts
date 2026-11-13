import type { Request, Response } from 'express';
import { rateLimit } from 'express-rate-limit';

const rateLimitedHandler = (message: string) => (_req: Request, res: Response) => {
  res.status(429).json({ error: { code: 'RATE_LIMITED', message } });
};

/** /auth/login: tối đa 10 lần mỗi 15 phút theo IP. */
export function createLoginLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: rateLimitedHandler('Bạn đăng nhập quá nhiều lần. Vui lòng thử lại sau 15 phút.'),
  });
}

/** Gửi tin nhắn chat: tối đa 20 tin mỗi phút theo người dùng (dùng sau requireAuth). */
export function createChatLimiter() {
  return rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => `user:${req.user?.id ?? 'anonymous'}`,
    handler: rateLimitedHandler('Bạn gửi tin nhắn quá nhanh. Vui lòng chờ một chút rồi thử lại.'),
  });
}
