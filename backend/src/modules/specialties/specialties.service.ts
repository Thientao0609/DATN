import type { Specialty } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError, isPrismaError, notFound } from '../../lib/errors.js';

export function toSpecialtyDto(s: Specialty) {
  return { id: s.id, name: s.name, description: s.description, symptomHints: s.symptomHints };
}

export async function listSpecialties() {
  const rows = await prisma.specialty.findMany({ orderBy: { name: 'asc' } });
  return rows.map(toSpecialtyDto);
}

export interface SpecialtyInput {
  name: string;
  description: string;
  symptomHints: string;
}

function rethrowDuplicate(err: unknown): never {
  if (isPrismaError(err, 'P2002')) throw new AppError('CONFLICT', 'Tên chuyên khoa đã tồn tại.');
  throw err;
}

export async function createSpecialty(input: SpecialtyInput) {
  try {
    return toSpecialtyDto(await prisma.specialty.create({ data: input }));
  } catch (err) {
    rethrowDuplicate(err);
  }
}

export async function updateSpecialty(id: string, input: Partial<SpecialtyInput>) {
  const existing = await prisma.specialty.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw notFound('Không tìm thấy chuyên khoa.');
  try {
    return toSpecialtyDto(await prisma.specialty.update({ where: { id }, data: input }));
  } catch (err) {
    rethrowDuplicate(err);
  }
}

/** Không xóa dây chuyền: chuyên khoa còn bác sĩ (và do đó có thể có lịch hẹn) thì từ chối. */
export async function deleteSpecialty(id: string): Promise<void> {
  const specialty = await prisma.specialty.findUnique({ where: { id }, include: { _count: { select: { doctors: true } } } });
  if (!specialty) throw notFound('Không tìm thấy chuyên khoa.');
  if (specialty._count.doctors > 0) {
    throw new AppError('CONFLICT', 'Chuyên khoa đang có bác sĩ nên không thể xóa. Hãy chuyển hoặc xóa bác sĩ trước.');
  }
  await prisma.specialty.delete({ where: { id } });
}
