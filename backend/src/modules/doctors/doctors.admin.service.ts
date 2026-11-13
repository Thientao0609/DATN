/** Quản lý bác sĩ dành cho ADMIN: tài khoản DOCTOR chỉ được tạo ở đây. */
import { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError, isPrismaError, notFound } from '../../lib/errors.js';
import { hashPassword } from '../auth/auth.service.js';
import { doctorInclude, toDoctorDto } from './doctors.service.js';

export interface CreateDoctorInput {
  email: string;
  password: string;
  fullName: string;
  phone?: string;
  specialtyId: string;
  bio: string;
  fee: number;
  slotMinutes?: number;
}

export type UpdateDoctorInput = Partial<Omit<CreateDoctorInput, 'email' | 'password'>>;

async function loadAdminDoctor(id: string) {
  const d = await prisma.doctor.findUnique({ where: { id }, include: { ...doctorInclude, _count: { select: { appointments: true } } } });
  if (!d) throw notFound('Không tìm thấy bác sĩ.');
  return { ...toDoctorDto(d), email: d.user.email, phone: d.user.phone, appointmentCount: d._count.appointments };
}

export async function listDoctorsForAdmin() {
  const rows = await prisma.doctor.findMany({
    include: { ...doctorInclude, _count: { select: { appointments: true } } },
    orderBy: { user: { fullName: 'asc' } },
  });
  return rows.map((d) => ({ ...toDoctorDto(d), email: d.user.email, phone: d.user.phone, appointmentCount: d._count.appointments }));
}

async function assertSpecialtyExists(id: string) {
  const s = await prisma.specialty.findUnique({ where: { id }, select: { id: true } });
  if (!s) throw notFound('Không tìm thấy chuyên khoa.');
}

export async function createDoctor(input: CreateDoctorInput) {
  await assertSpecialtyExists(input.specialtyId);
  const passwordHash = await hashPassword(input.password);
  try {
    const doctor = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: input.email, passwordHash, fullName: input.fullName, phone: input.phone ?? null, role: Role.DOCTOR },
      });
      return tx.doctor.create({
        data: { userId: user.id, specialtyId: input.specialtyId, bio: input.bio, fee: input.fee, slotMinutes: input.slotMinutes ?? 30 },
      });
    });
    return loadAdminDoctor(doctor.id);
  } catch (err) {
    if (isPrismaError(err, 'P2002')) throw new AppError('CONFLICT', 'Email này đã được sử dụng.');
    throw err;
  }
}

export async function updateDoctor(id: string, input: UpdateDoctorInput) {
  const existing = await prisma.doctor.findUnique({ where: { id }, select: { id: true, userId: true } });
  if (!existing) throw notFound('Không tìm thấy bác sĩ.');
  if (input.specialtyId) await assertSpecialtyExists(input.specialtyId);
  await prisma.$transaction(async (tx) => {
    if (input.fullName !== undefined || input.phone !== undefined) {
      await tx.user.update({
        where: { id: existing.userId },
        data: { ...(input.fullName !== undefined ? { fullName: input.fullName } : {}), ...(input.phone !== undefined ? { phone: input.phone } : {}) },
      });
    }
    await tx.doctor.update({
      where: { id },
      data: {
        ...(input.specialtyId !== undefined ? { specialtyId: input.specialtyId } : {}),
        ...(input.bio !== undefined ? { bio: input.bio } : {}),
        ...(input.fee !== undefined ? { fee: input.fee } : {}),
        ...(input.slotMinutes !== undefined ? { slotMinutes: input.slotMinutes } : {}),
      },
    });
  });
  return loadAdminDoctor(id);
}

/** Bác sĩ đã có lịch hẹn thì từ chối xóa; nếu chưa có thì xóa lịch làm việc, hồ sơ và tài khoản. */
export async function deleteDoctor(id: string): Promise<void> {
  const doctor = await prisma.doctor.findUnique({ where: { id }, include: { _count: { select: { appointments: true } } } });
  if (!doctor) throw notFound('Không tìm thấy bác sĩ.');
  if (doctor._count.appointments > 0) {
    throw new AppError('CONFLICT', 'Bác sĩ đã có lịch hẹn nên không thể xóa.');
  }
  await prisma.$transaction([
    prisma.workingSchedule.deleteMany({ where: { doctorId: id } }),
    prisma.doctor.delete({ where: { id } }),
    prisma.user.delete({ where: { id: doctor.userId } }),
  ]);
}
