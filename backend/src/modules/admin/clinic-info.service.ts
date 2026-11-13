import type { ClinicInfo } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError, isPrismaError, notFound } from '../../lib/errors.js';

export function toClinicInfoDto(c: ClinicInfo) {
  return { id: c.id, topic: c.topic, content: c.content };
}

export async function listClinicInfo() {
  return (await prisma.clinicInfo.findMany({ orderBy: { topic: 'asc' } })).map(toClinicInfoDto);
}

/** Bỏ dấu tiếng Việt và chuyển về chữ thường để so khớp từ khóa. */
export function normalizeVi(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/** Các mục ClinicInfo khớp nhiều từ khóa nhất (tối đa `limit` mục). */
export async function searchClinicInfo(query: string, limit = 3) {
  const all = await prisma.clinicInfo.findMany();
  const tokens = [...new Set(normalizeVi(query).split(/[^a-z0-9]+/).filter((t) => t.length >= 2))];
  const scored = all
    .map((item) => {
      const topic = normalizeVi(item.topic);
      const body = normalizeVi(item.content);
      const score = tokens.reduce((sum, t) => sum + (topic.includes(t) ? 3 : 0) + (body.includes(t) ? 1 : 0), 0);
      return { item, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return { results: scored.map((x) => toClinicInfoDto(x.item)), availableTopics: all.map((c) => c.topic) };
}

function rethrowDuplicate(err: unknown): never {
  if (isPrismaError(err, 'P2002')) throw new AppError('CONFLICT', 'Chủ đề này đã tồn tại.');
  throw err;
}

export async function createClinicInfo(input: { topic: string; content: string }) {
  try {
    return toClinicInfoDto(await prisma.clinicInfo.create({ data: input }));
  } catch (err) {
    rethrowDuplicate(err);
  }
}

export async function updateClinicInfo(id: string, input: { topic?: string; content?: string }) {
  const existing = await prisma.clinicInfo.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw notFound('Không tìm thấy mục thông tin.');
  try {
    return toClinicInfoDto(await prisma.clinicInfo.update({ where: { id }, data: input }));
  } catch (err) {
    rethrowDuplicate(err);
  }
}

export async function deleteClinicInfo(id: string): Promise<void> {
  const existing = await prisma.clinicInfo.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw notFound('Không tìm thấy mục thông tin.');
  await prisma.clinicInfo.delete({ where: { id } });
}
