import type { Request, Response } from 'express';
import { idParamsSchema } from '../../lib/validation.js';
import { getAvailableSlots } from '../appointments/appointments.service.js';
import { searchQuerySchema, slotsQuerySchema } from './doctors.schema.js';
import * as doctorsService from './doctors.service.js';

export async function search(req: Request, res: Response) {
  const query = searchQuerySchema.parse(req.query);
  res.json({ doctors: await doctorsService.searchDoctors({ specialtyId: query.specialtyId || undefined, q: query.q }) });
}

export async function detail(req: Request, res: Response) {
  const { id } = idParamsSchema.parse(req.params);
  res.json({ doctor: await doctorsService.getDoctor(id) });
}

export async function slots(req: Request, res: Response) {
  const { id } = idParamsSchema.parse(req.params);
  const { date } = slotsQuerySchema.parse(req.query);
  res.json({ date, slots: await getAvailableSlots(id, date) });
}
