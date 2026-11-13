import type { Request, Response } from 'express';
import { idParamsSchema } from '../../lib/validation.js';
import * as specialties from '../specialties/specialties.service.js';
import * as doctors from '../doctors/doctors.admin.service.js';
import * as schedules from '../schedules/schedules.service.js';
import * as clinicInfo from './clinic-info.service.js';
import { getStats } from './stats.service.js';
import {
  clinicInfoPatchSchema,
  clinicInfoSchema,
  createDoctorSchema,
  scheduleQuerySchema,
  schedulePatchSchema,
  scheduleSchema,
  specialtyPatchSchema,
  specialtySchema,
  updateDoctorSchema,
} from './admin.schema.js';

const idOf = (req: Request) => idParamsSchema.parse(req.params).id;

// Chuyên khoa
export async function listSpecialties(_req: Request, res: Response) {
  res.json({ specialties: await specialties.listSpecialties() });
}
export async function createSpecialty(req: Request, res: Response) {
  res.status(201).json({ specialty: await specialties.createSpecialty(specialtySchema.parse(req.body)) });
}
export async function updateSpecialty(req: Request, res: Response) {
  res.json({ specialty: await specialties.updateSpecialty(idOf(req), specialtyPatchSchema.parse(req.body)) });
}
export async function deleteSpecialty(req: Request, res: Response) {
  await specialties.deleteSpecialty(idOf(req));
  res.status(204).end();
}

// Bác sĩ
export async function listDoctors(_req: Request, res: Response) {
  res.json({ doctors: await doctors.listDoctorsForAdmin() });
}
export async function createDoctor(req: Request, res: Response) {
  res.status(201).json({ doctor: await doctors.createDoctor(createDoctorSchema.parse(req.body)) });
}
export async function updateDoctor(req: Request, res: Response) {
  res.json({ doctor: await doctors.updateDoctor(idOf(req), updateDoctorSchema.parse(req.body)) });
}
export async function deleteDoctor(req: Request, res: Response) {
  await doctors.deleteDoctor(idOf(req));
  res.status(204).end();
}

// Lịch làm việc
export async function listSchedules(req: Request, res: Response) {
  const { doctorId } = scheduleQuerySchema.parse(req.query);
  res.json({ schedules: await schedules.listSchedules(doctorId) });
}
export async function createSchedule(req: Request, res: Response) {
  res.status(201).json({ schedule: await schedules.createSchedule(scheduleSchema.parse(req.body)) });
}
export async function updateSchedule(req: Request, res: Response) {
  res.json({ schedule: await schedules.updateSchedule(idOf(req), schedulePatchSchema.parse(req.body)) });
}
export async function deleteSchedule(req: Request, res: Response) {
  await schedules.deleteSchedule(idOf(req));
  res.status(204).end();
}

// Thông tin phòng khám
export async function listClinicInfo(_req: Request, res: Response) {
  res.json({ items: await clinicInfo.listClinicInfo() });
}
export async function createClinicInfo(req: Request, res: Response) {
  res.status(201).json({ item: await clinicInfo.createClinicInfo(clinicInfoSchema.parse(req.body)) });
}
export async function updateClinicInfo(req: Request, res: Response) {
  res.json({ item: await clinicInfo.updateClinicInfo(idOf(req), clinicInfoPatchSchema.parse(req.body)) });
}
export async function deleteClinicInfo(req: Request, res: Response) {
  await clinicInfo.deleteClinicInfo(idOf(req));
  res.status(204).end();
}

// Thống kê
export async function stats(_req: Request, res: Response) {
  res.json(await getStats());
}
