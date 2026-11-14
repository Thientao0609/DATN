/**
 * Gửi email thông báo. Có SMTP_HOST thì gửi qua SMTP; không có thì lưu thành file .eml
 * trong backend/outbox/ để kiểm tra khi phát triển. Test thay bằng bộ gửi giả qua setMailer().
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

function fromAddress(): string {
  return env.MAIL_FROM || `${env.CLINIC_NAME} <no-reply@phongkham.local>`;
}

function createSmtpMailer(): Mailer {
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS ?? '' } } : {}),
  });
  return {
    async send(message) {
      await transport.sendMail({ from: fromAddress(), ...message });
    },
  };
}

function createOutboxMailer(dir = path.resolve(process.cwd(), 'outbox')): Mailer {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  return {
    async send(message) {
      const info = await transport.sendMail({ from: fromAddress(), ...message });
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.eml`);
      await writeFile(file, info.message as Buffer);
      // Chỉ log nơi lưu, không log nội dung email.
      console.info(`[mail] Chưa cấu hình SMTP, đã lưu email vào ${path.relative(process.cwd(), file)}`);
    },
  };
}

let current: Mailer | null = null;

export function getMailer(): Mailer {
  current ??= env.SMTP_HOST ? createSmtpMailer() : createOutboxMailer();
  return current;
}

/**
 * Gửi email mà không ném lỗi: gọi sau khi thao tác đã ghi xong, nên lỗi gửi mail chỉ được ghi log
 * (không log nội dung) chứ không làm hỏng thao tác. Trả true nếu gửi được.
 */
export async function sendMailSafely(message: MailMessage, label: string): Promise<boolean> {
  try {
    await getMailer().send(message);
    return true;
  } catch (err) {
    console.error(`[mail] Gửi email ${label} thất bại:`, err instanceof Error ? err.message : err);
    return false;
  }
}

/** Thay bộ gửi (dùng trong test). Truyền null để quay về mặc định. */
export function setMailer(mailer: Mailer | null): void {
  current = mailer;
}
