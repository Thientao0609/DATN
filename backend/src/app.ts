import express, { type Express } from 'express';
import cors from 'cors';
import { frontendOrigins } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { specialtiesRoutes } from './modules/specialties/specialties.routes.js';
import { doctorsRoutes } from './modules/doctors/doctors.routes.js';
import { appointmentsRoutes } from './modules/appointments/appointments.routes.js';
import { chatRoutes } from './modules/chat/chat.routes.js';
import { adminRoutes } from './modules/admin/admin.routes.js';
import { clinicInfoRoutes } from './modules/clinic-info/clinic-info.routes.js';

/** Tạo app Express. Mỗi lần gọi có bộ đếm rate limit riêng (tiện cho test). */
export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: frontendOrigins }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api/auth', authRoutes());
  app.use('/api/specialties', specialtiesRoutes());
  app.use('/api/doctors', doctorsRoutes());
  app.use('/api/clinic-info', clinicInfoRoutes());
  app.use('/api/appointments', appointmentsRoutes());
  app.use('/api/chat', chatRoutes());
  app.use('/api/admin', adminRoutes());

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
