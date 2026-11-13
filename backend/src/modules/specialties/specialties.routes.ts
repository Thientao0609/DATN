import { Router } from 'express';
import * as controller from './specialties.controller.js';

export function specialtiesRoutes(): Router {
  const router = Router();
  router.get('/', controller.list);
  return router;
}
