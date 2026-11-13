import { Router } from 'express';
import * as controller from './clinic-info.controller.js';

export function clinicInfoRoutes(): Router {
  const router = Router();
  router.get('/', controller.list);
  return router;
}
