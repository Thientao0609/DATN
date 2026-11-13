import type { MailMessage } from '../src/lib/mailer.js';

/** Email "đã gửi" trong lúc chạy test (không gửi thật, không ghi file). */
export const sentMails: MailMessage[] = [];
