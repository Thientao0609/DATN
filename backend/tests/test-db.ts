import dotenv from 'dotenv';

dotenv.config({ quiet: true });

/** Chuỗi kết nối database test: cùng server, tên database thêm hậu tố _test. */
export function testDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  if (explicit) return explicit;
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('Thiếu DATABASE_URL trong backend/.env để suy ra database test.');
  const url = new URL(base);
  const name = url.pathname.replace(/^\//, '');
  if (!name) throw new Error('DATABASE_URL thiếu tên database.');
  url.pathname = `/${name.endsWith('_test') ? name : `${name}_test`}`;
  return url.toString();
}
