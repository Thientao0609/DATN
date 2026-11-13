import { Router } from 'express';
import { Role } from '@prisma/client';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import * as c from './admin.controller.js';

export function adminRoutes(): Router {
  const router = Router();
  router.use(requireAuth, requireRole(Role.ADMIN));

  router.get('/specialties', c.listSpecialties);
  router.post('/specialties', c.createSpecialty);
  router.patch('/specialties/:id', c.updateSpecialty);
  router.delete('/specialties/:id', c.deleteSpecialty);

  router.get('/doctors', c.listDoctors);
  router.post('/doctors', c.createDoctor);
  router.patch('/doctors/:id', c.updateDoctor);
  router.delete('/doctors/:id', c.deleteDoctor);

  router.get('/schedules', c.listSchedules);
  router.post('/schedules', c.createSchedule);
  router.patch('/schedules/:id', c.updateSchedule);
  router.delete('/schedules/:id', c.deleteSchedule);

  router.get('/clinic-info', c.listClinicInfo);
  router.post('/clinic-info', c.createClinicInfo);
  router.patch('/clinic-info/:id', c.updateClinicInfo);
  router.delete('/clinic-info/:id', c.deleteClinicInfo);

  router.get('/appointments', c.listAppointments);
  router.get('/stats', c.stats);
  return router;
}
