import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { AppError } from '../lib/errors.js';
import { verifyToken } from '../lib/jwt.js';
import type { AuthUser } from '../types/express.js';

/** Xác thực header Authorization: Bearer <token>. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
  const user = token ? verifyToken(token) : null;
  if (!user) {
    next(new AppError('UNAUTHORIZED', 'Bạn cần đăng nhập để tiếp tục.'));
    return;
  }
  req.user = user;
  next();
}

/** Chỉ cho phép các vai trò được liệt kê; dùng sau requireAuth. */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new AppError('UNAUTHORIZED', 'Bạn cần đăng nhập để tiếp tục.'));
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(new AppError('FORBIDDEN', 'Bạn không có quyền truy cập chức năng này.'));
      return;
    }
    next();
  };
}

/** Người dùng đã xác thực của request (sau requireAuth). */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw new AppError('UNAUTHORIZED', 'Bạn cần đăng nhập để tiếp tục.');
  return req.user;
}
