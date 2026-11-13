import type { Request, Response } from 'express';
import { CreatedVia } from '@prisma/client';
import { currentUser } from '../../middleware/auth.js';
import { idParamsSchema, toDate } from '../../lib/validation.js';
import { createAppointmentSchema, listQuerySchema, rescheduleSchema } from './appointments.schema.js';
import * as service from './appointments.service.js';

export async function create(req: Request, res: Response) {
  const body = createAppointmentSchema.parse(req.body);
  const appointment = await service.createAppointment({
    patientId: currentUser(req).id,
    doctorId: body.doctorId,
    startTime: toDate(body.startTime),
    reason: body.reason,
    createdVia: CreatedVia.FORM,
  });
  res.status(201).json({ appointment });
}

export async function listMine(req: Request, res: Response) {
  const { status } = listQuerySchema.parse(req.query);
  res.json({ appointments: await service.listMyAppointments(currentUser(req), status) });
}

export async function reschedule(req: Request, res: Response) {
  const { id } = idParamsSchema.parse(req.params);
  const body = rescheduleSchema.parse(req.body);
  const appointment = await service.rescheduleAppointment({
    patientId: currentUser(req).id,
    appointmentId: id,
    newStartTime: toDate(body.startTime),
  });
  res.json({ appointment });
}

export async function cancel(req: Request, res: Response) {
  const { id } = idParamsSchema.parse(req.params);
  res.json({ appointment: await service.cancelAppointment({ patientId: currentUser(req).id, appointmentId: id }) });
}

export async function complete(req: Request, res: Response) {
  const { id } = idParamsSchema.parse(req.params);
  res.json({ appointment: await service.completeAppointment({ doctorUserId: currentUser(req).id, appointmentId: id }) });
}
