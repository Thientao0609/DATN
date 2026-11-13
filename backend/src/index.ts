import { env } from './config/env.js';
import { createApp } from './app.js';
import { prisma } from './lib/prisma.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.info(`Backend đang chạy tại http://localhost:${env.PORT}/api`);
});

function shutdown(signal: string) {
  console.info(`Nhận ${signal}, đang tắt server...`);
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0));
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
