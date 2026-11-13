import { Router } from 'express';
import * as controller from './doctors.controller.js';

export function doctorsRoutes(): Router {
  const router = Router();
  router.get('/', controller.search);
  router.get('/:id', controller.detail);
  router.get('/:id/slots', controller.slots);
  return router;
}
