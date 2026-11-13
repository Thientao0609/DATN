import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ quiet: true });

const required = (name: string) => z.string({ error: `Thiếu biến môi trường ${name}` }).trim().min(1, `Thiếu biến môi trường ${name}`);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: required('DATABASE_URL').refine((v) => v.startsWith('mysql://'), 'DATABASE_URL phải là chuỗi kết nối mysql://'),
  JWT_SECRET: required('JWT_SECRET').refine((v) => v.length >= 32, 'JWT_SECRET phải dài tối thiểu 32 ký tự'),
  PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_ORIGIN: required('FRONTEND_ORIGIN'),
  LLM_BASE_URL: required('LLM_BASE_URL'),
  LLM_API_KEY: required('LLM_API_KEY'),
  LLM_MODEL: required('LLM_MODEL'),
  CLINIC_NAME: required('CLINIC_NAME'),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    // Không in giá trị biến, chỉ in tên và lỗi.
    console.error(`Cấu hình không hợp lệ, server không khởi động:\n${problems}\nXem backend/.env.example.`);
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();

export const frontendOrigins = env.FRONTEND_ORIGIN.split(',')
  .map((o) => o.trim())
  .filter(Boolean);
