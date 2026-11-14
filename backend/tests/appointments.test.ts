import request from 'supertest';
import { AppointmentStatus, Role } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { HOUR_MS, MINUTE_MS } from '../src/lib/time.js';
import { getAvailableSlots } from '../src/modules/appointments/appointments.service.js';
import { authHeader, createDoctor, createSpecialty, createUser, nextSunday, resetDb, vnIso, vnTime, workingDate } from './helpers.js';
import { sentMails } from './fake-mailer.js';

const app = createApp();
const REASON = 'Đau họng và sốt nhẹ hai ngày';
const CHANGE_REASON = 'Trùng lịch công tác buổi sáng';
const CANCEL_REASON = 'Đã khỏi bệnh, không cần khám nữa';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

async function book(patient: { id: string; role: Role }, doctorId: string, startTime: string, reason = REASON) {
  return request(app).post('/api/appointments').set(authHeader(patient)).send({ doctorId, startTime, reason });
}

function requestChange(patient: { id: string; role: Role }, id: string, startTime: string, changeReason = CHANGE_REASON) {
  return request(app).patch(`/api/appointments/${id}/reschedule`).set(authHeader(patient)).send({ startTime, changeReason });
}

describe('Tra cứu công khai', () => {
  it('danh sách chuyên khoa và tìm bác sĩ theo khoa hoặc tên', async () => {
    const tmh = await createSpecialty('Tai mũi họng');
    const da = await createSpecialty('Da liễu');
    await createDoctor({ specialtyId: tmh.id, fullName: 'Hoàng Quốc Huy' });
    await createDoctor({ specialtyId: da.id, fullName: 'Lê Minh Châu' });

    const specialties = await request(app).get('/api/specialties');
    expect(specialties.status).toBe(200);
    expect(specialties.body.specialties.map((s: { name: string }) => s.name)).toEqual(['Da liễu', 'Tai mũi họng']);

    const byKhoa = await request(app).get('/api/doctors').query({ specialtyId: tmh.id });
    expect(byKhoa.body.doctors).toHaveLength(1);
    expect(byKhoa.body.doctors[0]).toMatchObject({ fullName: 'Hoàng Quốc Huy', specialty: { name: 'Tai mũi họng' } });
    expect(byKhoa.body.doctors[0]).not.toHaveProperty('email');

    // Tìm không dấu vẫn khớp tên có dấu (collation của MySQL).
    const byName = await request(app).get('/api/doctors').query({ q: 'chau' });
    expect(byName.body.doctors.map((d: { fullName: string }) => d.fullName)).toEqual(['Lê Minh Châu']);

    const detail = await request(app).get(`/api/doctors/${byKhoa.body.doctors[0].id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.doctor.schedules).toHaveLength(12);
    expect((await request(app).get('/api/doctors/khong-co')).status).toBe(404);
  });
});

describe('Sinh khung giờ trống', () => {
  it('chia lịch làm việc thành khung 30 phút', async () => {
    const { doctor } = await createDoctor();
    const date = workingDate(2);
    const res = await request(app).get(`/api/doctors/${doctor.id}/slots`).query({ date });
    expect(res.status).toBe(200);
    expect(res.body.slots).toHaveLength(14);
    expect(res.body.slots[0]).toEqual({ startTime: vnIso(date, '08:00'), endTime: vnIso(date, '08:30'), time: '08:00' });
    expect(res.body.slots.map((s: { time: string }) => s.time)).toContain('16:30');
    expect(res.body.slots.map((s: { time: string }) => s.time)).not.toContain('11:30');
  });

  it('Chủ nhật không có khung; ngày sai định dạng trả 400', async () => {
    const { doctor } = await createDoctor();
    expect((await request(app).get(`/api/doctors/${doctor.id}/slots`).query({ date: nextSunday() })).body.slots).toEqual([]);
    const bad = await request(app).get(`/api/doctors/${doctor.id}/slots`).query({ date: '2026-02-30' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('loại khung đã có lịch chưa hủy và khung bắt đầu trong vòng 60 phút tới', async () => {
    const { doctor } = await createDoctor();
    const patient = await createUser();
    const date = workingDate(2);
    expect((await book(patient, doctor.id, vnIso(date, '09:00'))).status).toBe(201);
    const slots = await getAvailableSlots(doctor.id, date);
    expect(slots.map((s) => s.time)).not.toContain('09:00');
    expect(slots).toHaveLength(13);

    // Giả lập "bây giờ" là 08:10 của ngày đó: khung 08:00 đã qua, 08:30 và 09:00 trong vòng 60 phút.
    const fakeNow = new Date(vnTime(date, '08:10').getTime());
    const nearSlots = await getAvailableSlots(doctor.id, date, fakeNow);
    expect(nearSlots[0]?.time).toBe('09:30');
  });
});

describe('Đặt lịch', () => {
  it('đặt thành công một khung hợp lệ', async () => {
    const { doctor } = await createDoctor();
    const patient = await createUser();
    const date = workingDate(2);
    const res = await book(patient, doctor.id, vnIso(date, '08:30'));
    expect(res.status).toBe(201);
    expect(res.body.appointment).toMatchObject({
      startTime: vnIso(date, '08:30'),
      endTime: vnIso(date, '09:00'),
      status: 'CONFIRMED',
      createdVia: 'FORM',
      reason: REASON,
      doctor: { id: doctor.id },
    });
    const stored = await prisma.appointment.findFirstOrThrow({ where: { id: res.body.appointment.id } });
    expect(stored.activeKey).toBe(1);
  });

  it('startTime lệch khung, quá 30 ngày hoặc trong vòng 60 phút trả SLOT_INVALID', async () => {
    const { doctor } = await createDoctor();
    const patient = await createUser();
    const date = workingDate(2);
    const offGrid = await book(patient, doctor.id, vnIso(date, '08:15'));
    expect(offGrid.status).toBe(422);
    expect(offGrid.body.error.code).toBe('SLOT_INVALID');
    expect((await book(patient, doctor.id, vnIso(date, '12:00'))).body.error.code).toBe('SLOT_INVALID');
    expect((await book(patient, doctor.id, vnIso(workingDate(35), '08:00'))).body.error.code).toBe('SLOT_INVALID');
    expect((await book(patient, doctor.id, vnIso(nextSunday(), '08:00'))).body.error.code).toBe('SLOT_INVALID');
    const soon = new Date(Date.now() + 30 * MINUTE_MS).toISOString();
    expect((await book(patient, doctor.id, soon)).body.error.code).toBe('SLOT_INVALID');
  });

  it('lý do khám bắt buộc từ 5 đến 500 ký tự', async () => {
    const { doctor } = await createDoctor();
    const patient = await createUser();
    const date = workingDate(2);
    const short = await book(patient, doctor.id, vnIso(date, '08:00'), 'đau');
    expect(short.status).toBe(400);
    expect(short.body.error.code).toBe('VALIDATION_ERROR');
    expect((await book(patient, doctor.id, vnIso(date, '08:00'), 'a'.repeat(501))).status).toBe(400);
  });

  it('10 request đồng thời cùng một khung giờ: đúng 1 thành công và 9 SLOT_TAKEN', async () => {
    const { doctor } = await createDoctor();
    const patients = await Promise.all(Array.from({ length: 10 }, () => createUser()));
    const startTime = vnIso(workingDate(3), '10:00');
    const results = await Promise.all(patients.map((p) => book(p, doctor.id, startTime)));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    const failures = results.filter((r) => r.status !== 201);
    expect(failures).toHaveLength(9);
    for (const f of failures) {
      expect(f.status).toBe(409);
      expect(f.body.error.code).toBe('SLOT_TAKEN');
    }
    expect(await prisma.appointment.count({ where: { doctorId: doctor.id, activeKey: 1 } })).toBe(1);
  });

  it('cùng một bệnh nhân gửi 10 request đồng thời cũng chỉ có 1 lịch', async () => {
    const { doctor } = await createDoctor();
    const patient = await createUser();
    const startTime = vnIso(workingDate(3), '14:00');
    const results = await Promise.all(Array.from({ length: 10 }, () => book(patient, doctor.id, startTime)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409 && r.body.error.code === 'SLOT_TAKEN')).toHaveLength(9);
  });

  it('bệnh nhân không có hai lịch trùng giờ và tối đa 3 lịch sắp tới', async () => {
    const { doctor: d1 } = await createDoctor();
    const { doctor: d2 } = await createDoctor();
    const patient = await createUser();
    const date = workingDate(2);
    expect((await book(patient, d1.id, vnIso(date, '08:00'))).status).toBe(201);
    const overlap = await book(patient, d2.id, vnIso(date, '08:00'));
    expect(overlap.status).toBe(422);
    expect(overlap.body.error.code).toBe('BOOKING_LIMIT');
    expect((await book(patient, d2.id, vnIso(date, '09:00'))).status).toBe(201);
    expect((await book(patient, d2.id, vnIso(date, '10:00'))).status).toBe(201);
    const fourth = await book(patient, d1.id, vnIso(date, '14:00'));
    expect(fourth.status).toBe(422);
    expect(fourth.body.error.code).toBe('BOOKING_LIMIT');
  });

  it('chỉ bệnh nhân mới đặt được lịch', async () => {
    const { doctor, user: doctorUser } = await createDoctor();
    expect((await book(doctorUser, doctor.id, vnIso(workingDate(2), '08:00'))).status).toBe(403);
    expect((await request(app).post('/api/appointments').send({})).status).toBe(401);
  });
});

describe('Đổi, hủy, hoàn thành', () => {
  it('bệnh nhân A không hủy hoặc đổi được lịch của B', async () => {
    const { doctor } = await createDoctor();
    const a = await createUser();
    const b = await createUser();
    const date = workingDate(2);
    const booked = await book(b, doctor.id, vnIso(date, '08:00'));
    const id = booked.body.appointment.id;
    const cancel = await request(app).patch(`/api/appointments/${id}/cancel`).set(authHeader(a)).send({ cancelReason: CANCEL_REASON });
    expect(cancel.status).toBe(403);
    expect(cancel.body.error.code).toBe('FORBIDDEN');
    const reschedule = await requestChange(a, id, vnIso(date, '09:00'));
    expect(reschedule.status).toBe(403);
    const stored = await prisma.appointment.findUniqueOrThrow({ where: { id } });
    expect(stored.status).toBe(AppointmentStatus.CONFIRMED);
    // A cũng không thấy lịch của B.
    const mine = await request(app).get('/api/appointments/me').set(authHeader(a));
    expect(mine.body.appointments).toEqual([]);
  });

  it('đổi và hủy lịch bắt buộc nhập lý do 5-500 ký tự', async () => {
    const { doctor } = await createDoctor();
    const patient = await createUser();
    const date = workingDate(2);
    const id = (await book(patient, doctor.id, vnIso(date, '08:00'))).body.appointment.id;
    const noReason = await request(app).patch(`/api/appointments/${id}/cancel`).set(authHeader(patient)).send({});
    expect(noReason.status).toBe(400);
    expect(noReason.body.error.message).toBe('Vui lòng nhập lý do hủy lịch.');
    const short = await request(app)
      .patch(`/api/appointments/${id}/reschedule`)
      .set(authHeader(patient))
      .send({ startTime: vnIso(date, '09:00'), changeReason: 'bận' });
    expect(short.status).toBe(400);
    expect(short.body.error.message).toBe('Vui lòng nhập lý do đổi lịch (ít nhất 5 ký tự).');
  });

  it('hủy lịch: status CANCELLED, activeKey null, lưu lý do, khung giờ trống lại và đặt lại được', async () => {
    const { doctor } = await createDoctor();
    const b = await createUser();
    const other = await createUser();
    const date = workingDate(2);
    const startTime = vnIso(date, '08:00');
    const id = (await book(b, doctor.id, startTime)).body.appointment.id;
    const res = await request(app).patch(`/api/appointments/${id}/cancel`).set(authHeader(b)).send({ cancelReason: CANCEL_REASON });
    expect(res.status).toBe(200);
    expect(res.body.appointment).toMatchObject({ status: 'CANCELLED', cancelReason: CANCEL_REASON });
    const stored = await prisma.appointment.findUniqueOrThrow({ where: { id } });
    expect(stored.activeKey).toBeNull();
    expect((await getAvailableSlots(doctor.id, date)).map((s) => s.time)).toContain('08:00');
    expect((await book(other, doctor.id, startTime)).status).toBe(201);
    const again = await request(app).patch(`/api/appointments/${id}/cancel`).set(authHeader(b)).send({ cancelReason: CANCEL_REASON });
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe('INVALID_STATUS');
  });

  it('đổi lịch áp dụng lại kiểm tra đặt lịch', async () => {
    const { doctor } = await createDoctor();
    const patient = await createUser();
    const other = await createUser();
    const date = workingDate(2);
    const id = (await book(patient, doctor.id, vnIso(date, '08:00'))).body.appointment.id;
    await book(other, doctor.id, vnIso(date, '09:00'));
    const taken = await requestChange(patient, id, vnIso(date, '09:00'));
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('SLOT_TAKEN');
    expect((await requestChange(patient, id, vnIso(date, '09:10'))).body.error.code).toBe('SLOT_INVALID');
    expect((await requestChange(patient, id, vnIso(date, '08:00'))).body.error.code).toBe('VALIDATION_ERROR');
  });

  it('đổi hoặc hủy trong vòng 2 giờ trước giờ khám trả TOO_LATE_TO_CHANGE', async () => {
    const { doctor } = await createDoctor();
    const patient = await createUser();
    const start = new Date(Date.now() + HOUR_MS);
    const appt = await prisma.appointment.create({
      data: { patientId: patient.id, doctorId: doctor.id, startTime: start, endTime: new Date(start.getTime() + 30 * MINUTE_MS), reason: REASON },
    });
    const cancel = await request(app).patch(`/api/appointments/${appt.id}/cancel`).set(authHeader(patient)).send({ cancelReason: CANCEL_REASON });
    expect(cancel.status).toBe(422);
    expect(cancel.body.error.code).toBe('TOO_LATE_TO_CHANGE');
    expect((await requestChange(patient, appt.id, vnIso(workingDate(2), '08:00'))).body.error.code).toBe('TOO_LATE_TO_CHANGE');
  });

  it('bác sĩ của lịch đánh dấu đã khám; bác sĩ khác bị từ chối; bác sĩ xem được lý do khám', async () => {
    const { doctor, user: doctorUser } = await createDoctor();
    const { user: otherDoctorUser } = await createDoctor();
    const patient = await createUser();
    const id = (await book(patient, doctor.id, vnIso(workingDate(2), '08:00'))).body.appointment.id;

    const list = await request(app).get('/api/appointments/me').set(authHeader(doctorUser));
    expect(list.body.appointments).toHaveLength(1);
    expect(list.body.appointments[0]).toMatchObject({ reason: REASON, patient: { id: patient.id } });
    expect((await request(app).get('/api/appointments/me').set(authHeader(otherDoctorUser))).body.appointments).toEqual([]);

    expect((await request(app).patch(`/api/appointments/${id}/complete`).set(authHeader(otherDoctorUser))).status).toBe(403);
    expect((await request(app).patch(`/api/appointments/${id}/complete`).set(authHeader(patient))).status).toBe(403);
    const done = await request(app).patch(`/api/appointments/${id}/complete`).set(authHeader(doctorUser));
    expect(done.status).toBe(200);
    expect(done.body.appointment.status).toBe('COMPLETED');

    const filtered = await request(app).get('/api/appointments/me').query({ status: 'COMPLETED' }).set(authHeader(patient));
    expect(filtered.body.appointments).toHaveLength(1);
    expect((await request(app).get('/api/appointments/me').query({ status: 'XYZ' }).set(authHeader(patient))).status).toBe(400);
  });
});

describe('Yêu cầu đổi lịch chờ admin duyệt', () => {
  it('gửi yêu cầu: lịch giữ giờ cũ, giữ chỗ giờ mới; admin duyệt thì chuyển chính lịch đó sang giờ mới', async () => {
    const { doctor } = await createDoctor();
    const patient = await createUser();
    const rival = await createUser();
    const admin = await createUser(Role.ADMIN);
    const date = workingDate(2);
    const id = (await book(patient, doctor.id, vnIso(date, '08:00'))).body.appointment.id;

    const req = await requestChange(patient, id, vnIso(date, '10:30'));
    expect(req.status).toBe(200);
    expect(req.body.appointment).toMatchObject({
      id,
      status: 'CONFIRMED',
      startTime: vnIso(date, '08:00'),
      pendingChange: { startTime: vnIso(date, '10:30'), endTime: vnIso(date, '11:00'), reason: CHANGE_REASON },
    });
    // Cả giờ cũ và giờ mới đều đang được giữ.
    let slots = (await getAvailableSlots(doctor.id, date)).map((s) => s.time);
    expect(slots).not.toContain('08:00');
    expect(slots).not.toContain('10:30');
    const steal = await book(rival, doctor.id, vnIso(date, '10:30'));
    expect(steal.status).toBe(409);
    expect(steal.body.error.code).toBe('SLOT_TAKEN');
    // Bệnh nhân chỉ thấy một lịch (bản ghi giữ chỗ nằm trong pendingChange).
    const mine = await request(app).get('/api/appointments/me').set(authHeader(patient));
    expect(mine.body.appointments).toHaveLength(1);

    const list = await request(app).get('/api/admin/reschedule-requests').set(authHeader(admin));
    expect(list.body.requests).toEqual([
      expect.objectContaining({
        appointmentId: id,
        currentStartTime: vnIso(date, '08:00'),
        requestedStartTime: vnIso(date, '10:30'),
        changeReason: CHANGE_REASON,
      }),
    ]);
    expect(JSON.stringify(list.body)).not.toContain(REASON);
    expect((await request(app).get('/api/admin/reschedule-requests').set(authHeader(patient))).status).toBe(403);

    const approved = await request(app).post(`/api/admin/reschedule-requests/${id}/approve`).set(authHeader(admin));
    expect(approved.status).toBe(200);
    expect(approved.body.appointment).toMatchObject({
      id,
      status: 'CONFIRMED',
      startTime: vnIso(date, '10:30'),
      previousStartTime: vnIso(date, '08:00'),
      changeReason: CHANGE_REASON,
      pendingChange: null,
    });
    slots = (await getAvailableSlots(doctor.id, date)).map((s) => s.time);
    expect(slots).toContain('08:00');
    expect(slots).not.toContain('10:30');
    expect(await prisma.appointment.count()).toBe(1);
    expect((await request(app).post(`/api/admin/reschedule-requests/${id}/approve`).set(authHeader(admin))).status).toBe(422);
  });

  it('admin từ chối: lịch giữ giờ cũ, giờ mới được trả lại, lưu lý do và gửi email cho bệnh nhân', async () => {
    const { doctor } = await createDoctor({ fullName: 'Hoàng Quốc Huy' });
    const patient = await createUser(Role.PATIENT, { fullName: 'Nguyễn Thị Mai', email: 'mai@test.local' });
    const admin = await createUser(Role.ADMIN);
    const date = workingDate(2);
    const id = (await book(patient, doctor.id, vnIso(date, '08:00'))).body.appointment.id;
    await requestChange(patient, id, vnIso(date, '14:00'));
    sentMails.length = 0;

    const noReason = await request(app).post(`/api/admin/reschedule-requests/${id}/reject`).set(authHeader(admin)).send({});
    expect(noReason.status).toBe(400);

    const rejected = await request(app)
      .post(`/api/admin/reschedule-requests/${id}/reject`)
      .set(authHeader(admin))
      .send({ reason: 'Bác sĩ có lịch hội chẩn chiều hôm đó' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.emailSent).toBe(true);
    expect(rejected.body.appointment).toMatchObject({
      id,
      status: 'CONFIRMED',
      startTime: vnIso(date, '08:00'),
      pendingChange: null,
      changeRejection: { requestedStartTime: vnIso(date, '14:00'), reason: 'Bác sĩ có lịch hội chẩn chiều hôm đó' },
    });
    expect((await getAvailableSlots(doctor.id, date)).map((s) => s.time)).toContain('14:00');
    expect(await prisma.appointment.count()).toBe(1);

    expect(sentMails).toHaveLength(1);
    expect(sentMails[0]).toMatchObject({ to: 'mai@test.local' });
    expect(sentMails[0]!.subject).toContain('chưa được chấp nhận');
    expect(sentMails[0]!.text).toContain('Nguyễn Thị Mai');
    expect(sentMails[0]!.text).toContain('Hoàng Quốc Huy');
    expect(sentMails[0]!.text).toContain('Bác sĩ có lịch hội chẩn chiều hôm đó');
    // Email không chứa lý do khám (dữ liệu sức khỏe).
    expect(sentMails[0]!.text).not.toContain(REASON);

    // Gửi yêu cầu mới thì thông báo từ chối cũ được xóa.
    const again = await requestChange(patient, id, vnIso(date, '15:00'));
    expect(again.body.appointment).toMatchObject({ changeRejection: null, pendingChange: { startTime: vnIso(date, '15:00') } });
  });

  it('gửi yêu cầu mới thay yêu cầu cũ; hủy lịch thì bỏ luôn yêu cầu đang chờ', async () => {
    const { doctor } = await createDoctor();
    const patient = await createUser();
    const date = workingDate(2);
    const id = (await book(patient, doctor.id, vnIso(date, '08:00'))).body.appointment.id;
    await requestChange(patient, id, vnIso(date, '09:00'));
    const second = await requestChange(patient, id, vnIso(date, '09:30'));
    expect(second.body.appointment.pendingChange.startTime).toBe(vnIso(date, '09:30'));
    let slots = (await getAvailableSlots(doctor.id, date)).map((s) => s.time);
    expect(slots).toContain('09:00');
    expect(slots).not.toContain('09:30');
    expect(await prisma.appointment.count()).toBe(2);

    await request(app).patch(`/api/appointments/${id}/cancel`).set(authHeader(patient)).send({ cancelReason: CANCEL_REASON }).expect(200);
    slots = (await getAvailableSlots(doctor.id, date)).map((s) => s.time);
    expect(slots).toEqual(expect.arrayContaining(['08:00', '09:30']));
    expect(await prisma.appointment.count()).toBe(1);
  });

  it('bác sĩ thấy khung đang giữ chỗ (PENDING); thống kê không đếm bản ghi giữ chỗ', async () => {
    const { doctor, user: doctorUser } = await createDoctor();
    const patient = await createUser();
    const admin = await createUser(Role.ADMIN);
    const date = workingDate(2);
    const id = (await book(patient, doctor.id, vnIso(date, '08:00'))).body.appointment.id;
    await requestChange(patient, id, vnIso(date, '13:30'));
    const docList = await request(app).get('/api/appointments/me').set(authHeader(doctorUser));
    expect(docList.body.appointments.map((a: { status: string; rescheduleOfId: string | null }) => [a.status, a.rescheduleOfId])).toEqual(
      expect.arrayContaining([
        ['CONFIRMED', null],
        ['PENDING', id],
      ]),
    );
    const stats = await request(app).get('/api/admin/stats').set(authHeader(admin));
    expect(stats.body.totals).toMatchObject({ appointments: 1, confirmed: 1, pendingReschedules: 1 });
  });
});

describe('Lịch khám công khai trên trang Đặt lịch', () => {
  it('ai cũng xem được; chỉ có bác sĩ, chuyên khoa, giờ; không có bệnh nhân, lý do hay mã lịch', async () => {
    const tmh = await createSpecialty('Tai mũi họng');
    const { doctor } = await createDoctor({ specialtyId: tmh.id, fullName: 'Hoàng Quốc Huy' });
    const { doctor: other } = await createDoctor({ fullName: 'Bác sĩ Khác' });
    const patient = await createUser(Role.PATIENT, { fullName: 'BENH_NHAN_BI_MAT' });
    const date = workingDate(2);
    const keep = (await book(patient, doctor.id, vnIso(date, '08:00'), 'LY_DO_BI_MAT_1')).body.appointment.id;
    const cancelled = (await book(patient, doctor.id, vnIso(date, '09:00'), 'LY_DO_BI_MAT_2')).body.appointment.id;
    await request(app).patch(`/api/appointments/${cancelled}/cancel`).set(authHeader(patient)).send({ cancelReason: CANCEL_REASON });
    await requestChange(patient, keep, vnIso(date, '10:00'));
    await book(patient, other.id, vnIso(date, '14:00'), 'LY_DO_BI_MAT_3');

    const res = await request(app).get('/api/appointments/calendar').query({ from: date, to: date });
    expect(res.status).toBe(200);
    expect(res.body.events).toEqual([
      { startTime: vnIso(date, '08:00'), endTime: vnIso(date, '08:30'), state: 'BOOKED', doctor: { id: doctor.id, fullName: 'Hoàng Quốc Huy' }, specialty: { id: tmh.id, name: 'Tai mũi họng' } },
      expect.objectContaining({ startTime: vnIso(date, '10:00'), state: 'HELD' }),
      expect.objectContaining({ startTime: vnIso(date, '14:00'), state: 'BOOKED', doctor: { id: other.id, fullName: 'Bác sĩ Khác' } }),
    ]);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/BENH_NHAN_BI_MAT|LY_DO_BI_MAT|patient|reason/);
    expect(raw).not.toContain(keep);

    const bySpecialty = await request(app).get('/api/appointments/calendar').query({ from: date, to: date, specialtyId: tmh.id });
    expect(bySpecialty.body.events).toHaveLength(2);
    expect((await request(app).get('/api/appointments/calendar').query({ from: date })).status).toBe(400);
  });
});
