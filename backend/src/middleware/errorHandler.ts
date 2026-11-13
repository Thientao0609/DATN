import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';

function sendError(res: Response, status: number, code: string, message: string, details?: unknown): void {
  res.status(status).json({ error: details === undefined ? { code, message } : { code, message, details } });
}

export function notFoundHandler(_req: Request, res: Response): void {
  sendError(res, 404, 'NOT_FOUND', 'Không tìm thấy đường dẫn này.');
}

// Express nhận diện error handler qua 4 tham số.
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    sendError(res, err.status, err.code, err.message, err.details);
    return;
  }
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    sendError(res, 400, 'VALIDATION_ERROR', details[0]?.message ?? 'Dữ liệu không hợp lệ.', details);
    return;
  }
  // Body JSON sai cú pháp (express.json) hoặc quá lớn.
  if (typeof err === 'object' && err !== null && 'type' in err) {
    const type = (err as { type: unknown }).type;
    if (type === 'entity.parse.failed') {
      sendError(res, 400, 'VALIDATION_ERROR', 'Dữ liệu gửi lên không phải JSON hợp lệ.');
      return;
    }
    if (type === 'entity.too.large') {
      sendError(res, 400, 'VALIDATION_ERROR', 'Dữ liệu gửi lên quá lớn.');
      return;
    }
  }
  console.error('[error]', err instanceof Error ? (err.stack ?? err.message) : err);
  sendError(res, 500, 'INTERNAL_ERROR', 'Đã có lỗi xảy ra, vui lòng thử lại sau.');
}
