/** Thống kê cho ADMIN. Không đọc trường reason (dữ liệu sức khỏe). */
import { AppointmentStatus, CreatedVia } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { toVnTimeString } from '../../lib/time.js';

const ratio = (part: number, total: number) => (total === 0 ? 0 : Math.round((part / total) * 10_000) / 10_000);

export async function getStats() {
  const [appointments, pendingReschedules, specialties] = await Promise.all([
    // Bỏ bản ghi giữ chỗ của yêu cầu đổi lịch để không đếm một lịch hai lần.
    prisma.appointment.findMany({
      where: { rescheduleOfId: null },
      select: { status: true, createdVia: true, startTime: true, doctor: { select: { specialtyId: true } } },
    }),
    prisma.appointment.count({ where: { rescheduleOfId: { not: null } } }),
    prisma.specialty.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);

  const total = appointments.length;
  const count = (pred: (a: (typeof appointments)[number]) => boolean) => appointments.filter(pred).length;
  const cancelled = count((a) => a.status === AppointmentStatus.CANCELLED);
  const viaChatbot = count((a) => a.createdVia === CreatedVia.CHATBOT);

  const bySpecialty = specialties.map((s) => {
    const rows = appointments.filter((a) => a.doctor.specialtyId === s.id);
    return {
      specialtyId: s.id,
      name: s.name,
      total: rows.length,
      confirmed: rows.filter((a) => a.status === AppointmentStatus.CONFIRMED).length,
      completed: rows.filter((a) => a.status === AppointmentStatus.COMPLETED).length,
      cancelled: rows.filter((a) => a.status === AppointmentStatus.CANCELLED).length,
    };
  });

  // Khung giờ đông nhất: đếm lịch chưa hủy theo giờ bắt đầu (giờ Việt Nam).
  const slotCounts = new Map<string, number>();
  for (const a of appointments) {
    if (a.status === AppointmentStatus.CANCELLED) continue;
    const time = toVnTimeString(a.startTime);
    slotCounts.set(time, (slotCounts.get(time) ?? 0) + 1);
  }
  const busiestSlots = [...slotCounts.entries()]
    .map(([time, n]) => ({ time, count: n }))
    .sort((a, b) => b.count - a.count || a.time.localeCompare(b.time))
    .slice(0, 5);

  return {
    totals: {
      appointments: total,
      confirmed: count((a) => a.status === AppointmentStatus.CONFIRMED),
      completed: count((a) => a.status === AppointmentStatus.COMPLETED),
      cancelled,
      viaChatbot,
      viaForm: total - viaChatbot,
      pendingReschedules,
    },
    cancelRate: ratio(cancelled, total),
    chatbotRate: ratio(viaChatbot, total),
    bySpecialty,
    busiestSlots,
  };
}
