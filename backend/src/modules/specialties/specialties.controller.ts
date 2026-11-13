import type { Request, Response } from 'express';
import * as specialtiesService from './specialties.service.js';

export async function list(_req: Request, res: Response) {
  res.json({ specialties: await specialtiesService.listSpecialties() });
}
