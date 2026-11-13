import { Router } from 'express';
import { Role } from '@prisma/client';
import { requireAuth, requireRole } from '../../middleware/auth.js';

/** Lớp phân quyền cho /admin/*; các route quản trị được thêm ở giai đoạn 6. */
export function adminRoutes(): Router {
  const router = Router();
  router.use(requireAuth, requireRole(Role.ADMIN));
  return router;
}
