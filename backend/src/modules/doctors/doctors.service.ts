import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { notFound } from '../../lib/errors.js';

export const doctorInclude = {
  user: { select: { fullName: true, email: true, phone: true } },
  specialty: { select: { id: true, name: true } },
  schedules: { select: { id: true, dayOfWeek: true, startTime: true, endTime: true }, orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }] },
} satisfies Prisma.DoctorInclude;

type DoctorWithRelations = Prisma.DoctorGetPayload<{ include: typeof doctorInclude }>;

/** Thông tin công khai của bác sĩ (không có email, số điện thoại). */
export function toDoctorDto(d: DoctorWithRelations) {
  return {
    id: d.id,
    fullName: d.user.fullName,
    specialty: d.specialty,
    bio: d.bio,
    fee: d.fee,
    slotMinutes: d.slotMinutes,
    schedules: d.schedules,
  };
}

export type DoctorDto = ReturnType<typeof toDoctorDto>;

export async function searchDoctors(filter: { specialtyId?: string; q?: string; limit?: number }): Promise<DoctorDto[]> {
  const q = filter.q?.trim();
  const rows = await prisma.doctor.findMany({
    where: {
      ...(filter.specialtyId ? { specialtyId: filter.specialtyId } : {}),
      ...(q ? { user: { fullName: { contains: q } } } : {}),
    },
    include: doctorInclude,
    orderBy: { user: { fullName: 'asc' } },
    ...(filter.limit ? { take: filter.limit } : {}),
  });
  return rows.map(toDoctorDto);
}

export async function getDoctor(id: string): Promise<DoctorDto> {
  const doctor = await prisma.doctor.findUnique({ where: { id }, include: doctorInclude });
  if (!doctor) throw notFound('Không tìm thấy bác sĩ.');
  return toDoctorDto(doctor);
}
