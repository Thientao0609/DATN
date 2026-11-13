import express, { type Express } from 'express';
import cors from 'cors';
import { frontendOrigins } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { specialtiesRoutes } from './modules/specialties/specialties.routes.js';

/** Tạo app Express. Mỗi lần gọi có bộ đếm rate limit riêng (tiện cho test). */
export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: frontendOrigins }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api/specialties', specialtiesRoutes());

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
