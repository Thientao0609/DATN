import { execSync } from 'node:child_process';
import { testDatabaseUrl } from './test-db.js';

/**
 * Tạo database test (nếu chưa có) và áp migrations trước khi chạy test.
 * Không xóa database; mỗi file test tự dọn dữ liệu bằng resetDb().
 */
export default function setup(): void {
  const url = testDatabaseUrl();
  if (!new URL(url).pathname.endsWith('_test')) {
    throw new Error('Database test phải có tên kết thúc bằng _test.');
  }
  execSync('npx prisma migrate deploy', { stdio: 'pipe', env: { ...process.env, DATABASE_URL: url } });
}
