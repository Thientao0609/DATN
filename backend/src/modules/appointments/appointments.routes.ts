import { Router } from 'express';
import { Role } from '@prisma/client';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import * as controller from './appointments.controller.js';

export function appointmentsRoutes(): Router {
  const router = Router();
  // Công khai, đặt trước requireAuth.
  router.get('/calendar', controller.calendar);
  router.use(requireAuth);
  router.post('/', requireRole(Role.PATIENT), controller.create);
  router.get('/me', requireRole(Role.PATIENT, Role.DOCTOR), controller.listMine);
  router.patch('/:id/reschedule', requireRole(Role.PATIENT), controller.reschedule);
  router.patch('/:id/cancel', requireRole(Role.PATIENT), controller.cancel);
  router.patch('/:id/complete', requireRole(Role.DOCTOR), controller.complete);
  return router;
}
