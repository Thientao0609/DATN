import request from 'supertest';
import { AppointmentStatus, CreatedVia, Role } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { MINUTE_MS } from '../src/lib/time.js';
import { authHeader, createDoctor, createSpecialty, createUser, resetDb, vnTime, workingDate } from './helpers.js';

const app = createApp();
let admin: Awaited<ReturnType<typeof createUser>>;

beforeEach(async () => {
  await resetDb();
  admin = await createUser(Role.ADMIN);
});
afterAll(() => prisma.$disconnect());

const as = () => authHeader(admin);

describe('Quyền truy cập', () => {
  it('ADMIN vào được mọi nhóm /admin/*', async () => {
    for (const path of ['/api/admin/stats', '/api/admin/specialties', '/api/admin/doctors', '/api/admin/schedules', '/api/admin/clinic-info']) {
      expect((await request(app).get(path).set(as())).status, path).toBe(200);
    }
  });
});

describe('Quản lý chuyên khoa', () => {
  it('tạo, sửa, xóa; tên trùng bị từ chối; khoa còn bác sĩ không xóa được', async () => {
    const created = await request(app).post('/api/admin/specialties').set(as()).send({ name: 'Mắt', description: 'Nhãn khoa', symptomHints: 'mờ mắt, đỏ mắt' });
    expect(created.status).toBe(201);
    const id = created.body.specialty.id;
    expect((await request(app).post('/api/admin/specialties').set(as()).send({ name: 'Mắt', description: 'x', symptomHints: 'y' })).status).toBe(409);
    const updated = await request(app).patch(`/api/admin/specialties/${id}`).set(as()).send({ description: 'Khám mắt' });
    expect(updated.body.specialty).toMatchObject({ name: 'Mắt', description: 'Khám mắt' });

    await createDoctor({ specialtyId: id });
    const blocked = await request(app).delete(`/api/admin/specialties/${id}`).set(as());
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toContain('đang có bác sĩ');

    const empty = await createSpecialty('Khoa trống');
    expect((await request(app).delete(`/api/admin/specialties/${empty.id}`).set(as())).status).toBe(204);
  });
});

describe('Quản lý bác sĩ', () => {
  it('tạo tài khoản DOCTOR đăng nhập được; bác sĩ có lịch hẹn không xóa được', async () => {
    const specialty = await createSpecialty();
    const created = await request(app).post('/api/admin/doctors').set(as()).send({
      email: 'bs.moi@test.local',
      password: 'Bacsi@123456',
      fullName: 'Bác sĩ Mới',
      specialtyId: specialty.id,
      bio: 'Giới thiệu',
      fee: 300000,
    });
    expect(created.status).toBe(201);
    expect(created.body.doctor).toMatchObject({ fullName: 'Bác sĩ Mới', email: 'bs.moi@test.local', slotMinutes: 30, appointmentCount: 0 });
    expect(JSON.stringify(created.body)).not.toContain('passwordHash');
    const login = await request(app).post('/api/auth/login').send({ email: 'bs.moi@test.local', password: 'Bacsi@123456' });
    expect(login.body.user).toMatchObject({ role: 'DOCTOR', doctorId: created.body.doctor.id });

    const patched = await request(app).patch(`/api/admin/doctors/${created.body.doctor.id}`).set(as()).send({ fee: 350000, fullName: 'Bác sĩ Đổi Tên' });
    expect(patched.body.doctor).toMatchObject({ fee: 350000, fullName: 'Bác sĩ Đổi Tên' });

    // Chưa có lịch hẹn: xóa được (kèm tài khoản).
    expect((await request(app).delete(`/api/admin/doctors/${created.body.doctor.id}`).set(as())).status).toBe(204);
    expect(await prisma.user.count({ where: { email: 'bs.moi@test.local' } })).toBe(0);

    // Có lịch hẹn: từ chối.
    const { doctor } = await createDoctor();
    const patient = await createUser();
    const date = workingDate(2);
    await request(app).post('/api/appointments').set(authHeader(patient)).send({ doctorId: doctor.id, startTime: `${date}T08:00:00+07:00`, reason: 'Khám tổng quát' });
    const blocked = await request(app).delete(`/api/admin/doctors/${doctor.id}`).set(as());
    expect(blocked.status).toBe(409);
    expect(await prisma.doctor.count({ where: { id: doctor.id } })).toBe(1);
  });
});

describe('Lịch làm việc và thông tin phòng khám', () => {
  it('lịch làm việc chồng giờ hoặc giờ kết thúc trước giờ bắt đầu bị từ chối', async () => {
    const { doctor } = await createDoctor();
    const overlap = await request(app).post('/api/admin/schedules').set(as()).send({ doctorId: doctor.id, dayOfWeek: 1, startTime: '11:00', endTime: '12:00' });
    expect(overlap.status).toBe(400);
    const reversed = await request(app).post('/api/admin/schedules').set(as()).send({ doctorId: doctor.id, dayOfWeek: 0, startTime: '10:00', endTime: '09:00' });
    expect(reversed.status).toBe(400);
    const sunday = await request(app).post('/api/admin/schedules').set(as()).send({ doctorId: doctor.id, dayOfWeek: 0, startTime: '08:00', endTime: '10:00' });
    expect(sunday.status).toBe(201);
    const list = await request(app).get('/api/admin/schedules').query({ doctorId: doctor.id }).set(as());
    expect(list.body.schedules).toHaveLength(13);
    const patched = await request(app).patch(`/api/admin/schedules/${sunday.body.schedule.id}`).set(as()).send({ endTime: '11:00' });
    expect(patched.body.schedule.endTime).toBe('11:00');
    expect((await request(app).delete(`/api/admin/schedules/${sunday.body.schedule.id}`).set(as())).status).toBe(204);
  });

  it('CRUD ClinicInfo', async () => {
    const created = await request(app).post('/api/admin/clinic-info').set(as()).send({ topic: 'Giờ làm việc', content: '08:00-17:00' });
    expect(created.status).toBe(201);
    const id = created.body.item.id;
    expect((await request(app).patch(`/api/admin/clinic-info/${id}`).set(as()).send({ content: '07:30-17:00' })).body.item.content).toBe('07:30-17:00');
    expect((await request(app).get('/api/admin/clinic-info').set(as())).body.items).toHaveLength(1);
    expect((await request(app).delete(`/api/admin/clinic-info/${id}`).set(as())).status).toBe(204);
  });
});

describe('Thống kê', () => {
  it('đếm theo khoa, tỉ lệ hủy, khung giờ đông nhất, tỉ lệ đặt qua chatbot; không lộ lý do khám', async () => {
    const tmh = await createSpecialty('Tai mũi họng');
    const da = await createSpecialty('Da liễu');
    const { doctor: d1 } = await createDoctor({ specialtyId: tmh.id });
    const { doctor: d2 } = await createDoctor({ specialtyId: da.id });
    const patient = await createUser();
    const date = workingDate(2);
    const rows = [
      { doctorId: d1.id, time: '08:00', status: AppointmentStatus.CONFIRMED, via: CreatedVia.CHATBOT },
      { doctorId: d1.id, time: '09:00', status: AppointmentStatus.COMPLETED, via: CreatedVia.FORM },
      { doctorId: d1.id, time: '10:00', status: AppointmentStatus.CANCELLED, via: CreatedVia.FORM },
      { doctorId: d2.id, time: '08:00', status: AppointmentStatus.CONFIRMED, via: CreatedVia.CHATBOT },
    ];
    for (const r of rows) {
      const start = vnTime(date, r.time);
      await prisma.appointment.create({
        data: {
          patientId: patient.id,
          doctorId: r.doctorId,
          startTime: start,
          endTime: new Date(start.getTime() + 30 * MINUTE_MS),
          reason: 'BI_MAT_SUC_KHOE',
          status: r.status,
          createdVia: r.via,
          activeKey: r.status === AppointmentStatus.CANCELLED ? null : 1,
        },
      });
    }
    const res = await request(app).get('/api/admin/stats').set(as());
    expect(res.status).toBe(200);
    expect(res.body.totals).toMatchObject({ appointments: 4, confirmed: 2, completed: 1, cancelled: 1, viaChatbot: 2, viaForm: 2 });
    expect(res.body.cancelRate).toBe(0.25);
    expect(res.body.chatbotRate).toBe(0.5);
    expect(res.body.bySpecialty).toEqual([
      expect.objectContaining({ name: 'Da liễu', total: 1, cancelled: 0 }),
      expect.objectContaining({ name: 'Tai mũi họng', total: 3, cancelled: 1, completed: 1, confirmed: 1 }),
    ]);
    expect(res.body.busiestSlots[0]).toEqual({ time: '08:00', count: 2 });
    expect(JSON.stringify(res.body)).not.toContain('BI_MAT_SUC_KHOE');
  });
});
