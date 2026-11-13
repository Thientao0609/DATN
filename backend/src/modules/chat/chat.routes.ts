import { Router } from 'express';
import { Role } from '@prisma/client';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { createChatLimiter } from '../../middleware/rateLimit.js';
import * as controller from './chat.controller.js';

export function chatRoutes(): Router {
  const router = Router();
  router.use(requireAuth, requireRole(Role.PATIENT));
  router.post('/sessions', controller.createSession);
  router.get('/sessions', controller.listSessions);
  router.get('/sessions/:id/messages', controller.listMessages);
  router.post('/sessions/:id/messages', createChatLimiter(), controller.sendMessage);
  router.post('/actions/:id/confirm', controller.confirmAction);
  router.post('/actions/:id/reject', controller.rejectAction);
  return router;
}
