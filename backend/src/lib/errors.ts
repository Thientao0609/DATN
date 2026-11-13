export const ERROR_STATUS = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  SLOT_TAKEN: 409,
  SLOT_INVALID: 422,
  TOO_LATE_TO_CHANGE: 422,
  INVALID_STATUS: 422,
  BOOKING_LIMIT: 422,
  ACTION_EXPIRED: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  LLM_UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = details;
  }
}

export const notFound = (message = 'Không tìm thấy dữ liệu.') => new AppError('NOT_FOUND', message);
export const forbidden = (message = 'Bạn không có quyền thực hiện thao tác này.') => new AppError('FORBIDDEN', message);

export function isPrismaError(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === code;
}
