import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { createLoginLimiter } from '../../middleware/rateLimit.js';
import * as controller from './auth.controller.js';

export function authRoutes(): Router {
  const router = Router();
  router.post('/register', controller.register);
  router.post('/login', createLoginLimiter(), controller.login);
  router.get('/me', requireAuth, controller.me);
  return router;
}
