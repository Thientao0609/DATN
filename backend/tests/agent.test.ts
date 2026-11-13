import request from 'supertest';
import { AppointmentStatus, CreatedVia, PendingActionStatus, Role } from '@prisma/client';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { setLlmClient } from '../src/modules/chat/llm.js';
import { agentTools, toolDefinitionsForModel } from '../src/modules/chat/tools.js';
import { authHeader, createDoctor, createSpecialty, createUser, resetDb, vnIso, workingDate } from './helpers.js';
import { ScriptedLlm, textStep, toolCallStep } from './fake-llm.js';

const app = createApp();
const REASON = 'Nổi mẩn đỏ và ngứa ở tay';

beforeEach(resetDb);
afterEach(() => setLlmClient(null));
afterAll(() => prisma.$disconnect());

async function newSession(patient: { id: string; role: Role }) {
  const res = await request(app).post('/api/chat/sessions').set(authHeader(patient)).send({});
  expect(res.status).toBe(201);
  return res.body.session.id as string;
}

function send(patient: { id: string; role: Role }, sessionId: string, content: string) {
  return request(app).post(`/api/chat/sessions/${sessionId}/messages`).set(authHeader(patient)).send({ content });
}

describe('Định nghĩa tools', () => {
  it('đủ 8 tools, tham số là JSON Schema và không tool nào nhận userId', () => {
    const defs = toolDefinitionsForModel();
    expect(defs.map((d) => d.function.name)).toEqual([
      'list_specialties',
      'search_doctors',
      'get_available_slots',
      'get_my_appointments',
      'lookup_clinic_info',
      'propose_booking',
      'propose_reschedule',
      'propose_cancel',
    ]);
    for (const d of defs) {
      expect(d.function.parameters).toMatchObject({ type: 'object' });
      expect(JSON.stringify(d.function.parameters)).not.toMatch(/userId|patientId/);
    }
    expect(agentTools.find((t) => t.name === 'propose_booking')?.parameters).toMatchObject({ required: ['doctorId', 'startTime', 'reason'] });
  });
});

describe('Vòng lặp agent với model giả lập', () => {
  it('tool đọc chạy đúng và kết quả được gửi lại cho model', async () => {
    await createSpecialty('Tai mũi họng', 'đau họng, ù tai, nghẹt mũi');
    const patient = await createUser(Role.PATIENT, { fullName: 'Nguyễn Thị Mai' });
    const llm = new ScriptedLlm([
      toolCallStep('list_specialties', {}),
      textStep('Bạn nên khám chuyên khoa Tai mũi họng. Thông tin chỉ mang tính tham khảo.'),
    ]);
    setLlmClient(llm);
    const sessionId = await newSession(patient);

    const res = await send(patient, sessionId, 'Tôi bị đau họng và ù tai mấy ngày nay');
    expect(res.status).toBe(200);
    expect(res.body.message).toMatchObject({ role: 'assistant', content: expect.stringContaining('Tai mũi họng') });
    expect(res.body.pendingAction).toBeNull();

    // Lần gọi đầu: system prompt có tên người dùng, tên phòng khám, kèm tools.
    const first = llm.requests[0]!;
    expect(first.messages[0]).toMatchObject({ role: 'system' });
    expect(first.messages[0]!.content).toContain('Nguyễn Thị Mai');
    expect(first.messages[0]!.content).toContain('Phòng khám Test');
    expect(first.messages[0]!.content).toContain('giờ Việt Nam');
    expect(first.messages.at(-1)).toEqual({ role: 'user', content: 'Tôi bị đau họng và ù tai mấy ngày nay' });
    expect(first.tools).toHaveLength(8);

    // Lần gọi thứ hai có kết quả tool thật từ database.
    const toolMsg = llm.requests[1]!.messages.at(-1)!;
    expect(toolMsg.role).toBe('tool');
    expect(toolMsg.content).toContain('ù tai');

    const stored = await prisma.chatMessage.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } });
    expect(stored.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);

    // Lịch sử hiển thị chỉ gồm tin nhắn user và câu trả lời cuối.
    const history = await request(app).get(`/api/chat/sessions/${sessionId}/messages`).set(authHeader(patient));
    expect(history.body.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant']);
  });

  it('get_available_slots và search_doctors trả dữ liệu thật', async () => {
    const da = await createSpecialty('Da liễu');
    const { doctor } = await createDoctor({ specialtyId: da.id, fullName: 'Phạm Thu Dung', fee: 250_000 });
    const patient = await createUser();
    const date = workingDate(2);
    const llm = new ScriptedLlm([
      toolCallStep('search_doctors', { specialtyId: da.id }),
      toolCallStep('get_available_slots', { doctorId: doctor.id, date }),
      textStep('Bác sĩ Phạm Thu Dung còn trống 08:00.'),
    ]);
    setLlmClient(llm);
    const sessionId = await newSession(patient);
    expect((await send(patient, sessionId, 'Tôi muốn khám da liễu')).status).toBe(200);

    const doctorsResult = JSON.parse(llm.requests[1]!.messages.at(-1)!.content as string);
    expect(doctorsResult.doctors).toEqual([{ id: doctor.id, fullName: 'Phạm Thu Dung', specialty: 'Da liễu', fee: 250_000 }]);
    const slotsResult = JSON.parse(llm.requests[2]!.messages.at(-1)!.content as string);
    expect(slotsResult.slots[0]).toEqual({ startTime: vnIso(date, '08:00'), time: '08:00' });
    expect(slotsResult.slots).toHaveLength(14);
  });

  it('trả slotOptions có cấu trúc để frontend hiện nút chọn giờ; không trả khi đã có đề xuất', async () => {
    const da = await createSpecialty('Da liễu');
    const { doctor } = await createDoctor({ specialtyId: da.id, fullName: 'Phạm Thu Dung' });
    const patient = await createUser();
    const date = workingDate(2);
    setLlmClient(
      new ScriptedLlm([
        toolCallStep('get_available_slots', { doctorId: doctor.id, date }),
        textStep('Bác sĩ còn các giờ sau, bạn chọn giờ nào?'),
        toolCallStep('get_available_slots', { doctorId: doctor.id, date }),
        toolCallStep('propose_booking', { doctorId: doctor.id, startTime: vnIso(date, '08:00'), reason: REASON }),
        textStep('Bấm Đồng ý nhé.'),
      ]),
    );
    const sessionId = await newSession(patient);
    const first = await send(patient, sessionId, 'Xem giờ trống');
    expect(first.body.slotOptions).toHaveLength(1);
    expect(first.body.slotOptions[0]).toMatchObject({ doctorId: doctor.id, doctorName: 'Phạm Thu Dung', specialtyName: 'Da liễu', date });
    expect(first.body.slotOptions[0].dateText).toMatch(/^Thứ .+, \d{2}\/\d{2}\/\d{4}$/);
    expect(first.body.slotOptions[0].slots[0]).toEqual({ startTime: vnIso(date, '08:00'), time: '08:00' });
    const second = await send(patient, sessionId, 'Đặt 8 giờ');
    expect(second.body.pendingAction).not.toBeNull();
    expect(second.body.slotOptions).toEqual([]);
  });

  it('propose_booking không tạo Appointment cho tới khi người dùng xác nhận', async () => {
    const { doctor } = await createDoctor({ fullName: 'Lê Minh Châu' });
    const patient = await createUser();
    const startTime = vnIso(workingDate(2), '09:30');
    setLlmClient(
      new ScriptedLlm([
        toolCallStep('propose_booking', { doctorId: doctor.id, startTime, reason: REASON }),
        textStep('Mình đã chuẩn bị lịch hẹn, bạn bấm Đồng ý để xác nhận nhé.'),
      ]),
    );
    const sessionId = await newSession(patient);
    const res = await send(patient, sessionId, 'Đặt giúp tôi lịch này');
    expect(res.status).toBe(200);
    expect(res.body.pendingAction).toMatchObject({
      type: 'CREATE',
      status: 'PENDING',
      summary: { doctorName: 'Lê Minh Châu', startTime, reason: REASON },
    });
    expect(await prisma.appointment.count()).toBe(0);
    const pending = await prisma.pendingAction.findUniqueOrThrow({ where: { id: res.body.pendingAction.id } });
    expect(pending.expiresAt.getTime() - pending.createdAt.getTime()).toBeGreaterThanOrEqual(9.9 * 60 * 1000);

    const restored = await request(app).get(`/api/chat/sessions/${sessionId}/messages`).set(authHeader(patient));
    expect(restored.body.pendingAction.id).toBe(res.body.pendingAction.id);

    const confirm = await request(app).post(`/api/chat/actions/${res.body.pendingAction.id}/confirm`).set(authHeader(patient));
    expect(confirm.status).toBe(200);
    expect(confirm.body.appointment).toMatchObject({ startTime, status: 'CONFIRMED', createdVia: 'CHATBOT' });
    expect(confirm.body.message.content).toContain('Đã đặt lịch thành công');

    const appointments = await prisma.appointment.findMany();
    expect(appointments).toHaveLength(1);
    expect(appointments[0]).toMatchObject({ patientId: patient.id, createdVia: CreatedVia.CHATBOT, status: AppointmentStatus.CONFIRMED });

    // Lịch mới xuất hiện ở "Lịch hẹn của tôi".
    const mine = await request(app).get('/api/appointments/me').set(authHeader(patient));
    expect(mine.body.appointments).toHaveLength(1);

    // Xác nhận lần hai bị từ chối.
    const twice = await request(app).post(`/api/chat/actions/${res.body.pendingAction.id}/confirm`).set(authHeader(patient));
    expect(twice.status).toBe(422);
    expect(await prisma.appointment.count()).toBe(1);
  });

  it('từ chối đề xuất: không tạo lịch, lưu tin nhắn vào phiên', async () => {
    const { doctor } = await createDoctor();
    const patient = await createUser();
    setLlmClient(
      new ScriptedLlm([toolCallStep('propose_booking', { doctorId: doctor.id, startTime: vnIso(workingDate(2), '10:00'), reason: REASON }), textStep('Bấm Đồng ý nhé.')]),
    );
    const sessionId = await newSession(patient);
    const { body } = await send(patient, sessionId, 'Đặt lịch');
    const reject = await request(app).post(`/api/chat/actions/${body.pendingAction.id}/reject`).set(authHeader(patient));
    expect(reject.status).toBe(200);
    expect(reject.body.pendingAction.status).toBe('REJECTED');
    expect(await prisma.appointment.count()).toBe(0);
    const history = await request(app).get(`/api/chat/sessions/${sessionId}/messages`).set(authHeader(patient));
    expect(history.body.messages.at(-1).content).toContain('Đã hủy đề xuất');
    expect(history.body.pendingAction).toBeNull();
  });

  it('người khác không xác nhận được đề xuất; khung giờ bị đặt trước khi xác nhận thì trả SLOT_TAKEN và lưu tin nhắn', async () => {
    const { doctor } = await createDoctor();
    const patient = await createUser();
    const stranger = await createUser();
    const rival = await createUser();
    const startTime = vnIso(workingDate(2), '14:00');
    setLlmClient(new ScriptedLlm([toolCallStep('propose_booking', { doctorId: doctor.id, startTime, reason: REASON }), textStep('Bấm Đồng ý nhé.')]));
    const sessionId = await newSession(patient);
    const { body } = await send(patient, sessionId, 'Đặt lịch 14:00');

    expect((await request(app).post(`/api/chat/actions/${body.pendingAction.id}/confirm`).set(authHeader(stranger))).status).toBe(403);

    // Người khác đặt cùng khung qua form trước khi bệnh nhân bấm Đồng ý.
    const viaForm = await request(app).post('/api/appointments').set(authHeader(rival)).send({ doctorId: doctor.id, startTime, reason: 'Khám da định kỳ' });
    expect(viaForm.status).toBe(201);

    const confirm = await request(app).post(`/api/chat/actions/${body.pendingAction.id}/confirm`).set(authHeader(patient));
    expect(confirm.status).toBe(409);
    expect(confirm.body.error.code).toBe('SLOT_TAKEN');
    expect(confirm.body.error.message).toContain('vừa có người đặt');
    expect(confirm.body.error.details.message.content).toContain('Chưa thực hiện được');
    expect(await prisma.appointment.count({ where: { patientId: patient.id } })).toBe(0);
    const action = await prisma.pendingAction.findUniqueOrThrow({ where: { id: body.pendingAction.id } });
    expect(action.status).toBe(PendingActionStatus.EXPIRED);
  });

  it('đề xuất mới làm đề xuất cũ hết hiệu lực; đề xuất quá 10 phút không xác nhận được', async () => {
    const { doctor } = await createDoctor();
    const patient = await createUser();
    const date = workingDate(2);
    setLlmClient(
      new ScriptedLlm([
        toolCallStep('propose_booking', { doctorId: doctor.id, startTime: vnIso(date, '08:00'), reason: REASON }),
        textStep('Bấm Đồng ý nhé.'),
        toolCallStep('propose_booking', { doctorId: doctor.id, startTime: vnIso(date, '08:30'), reason: REASON }),
        textStep('Đã đổi sang 08:30, bấm Đồng ý nhé.'),
      ]),
    );
    const sessionId = await newSession(patient);
    const first = (await send(patient, sessionId, 'Đặt 8 giờ')).body.pendingAction;
    const second = (await send(patient, sessionId, 'Thôi đổi sang 8 rưỡi')).body.pendingAction;
    expect((await prisma.pendingAction.findUniqueOrThrow({ where: { id: first.id } })).status).toBe(PendingActionStatus.EXPIRED);
    expect(await prisma.pendingAction.count({ where: { sessionId, status: PendingActionStatus.PENDING } })).toBe(1);
    expect((await request(app).post(`/api/chat/actions/${first.id}/confirm`).set(authHeader(patient))).status).toBe(422);

    await prisma.pendingAction.update({ where: { id: second.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await request(app).post(`/api/chat/actions/${second.id}/confirm`).set(authHeader(patient));
    expect(expired.status).toBe(422);
    expect(expired.body.error.code).toBe('ACTION_EXPIRED');
    expect(await prisma.appointment.count()).toBe(0);
  });

  it('propose_reschedule gửi yêu cầu chờ admin duyệt; propose_cancel hủy lịch kèm lý do', async () => {
    const { doctor } = await createDoctor();
    const patient = await createUser();
    const date = workingDate(2);
    const booked = await request(app).post('/api/appointments').set(authHeader(patient)).send({ doctorId: doctor.id, startTime: vnIso(date, '08:00'), reason: REASON });
    const apptId = booked.body.appointment.id;
    setLlmClient(
      new ScriptedLlm([
        toolCallStep('propose_reschedule', { appointmentId: apptId, newStartTime: vnIso(date, '15:00') }),
        textStep('Bạn cho mình biết lý do đổi lịch nhé.'),
        toolCallStep('propose_reschedule', { appointmentId: apptId, newStartTime: vnIso(date, '15:00'), changeReason: 'Buổi sáng phải đi làm' }),
        textStep('Bấm Đồng ý để gửi yêu cầu đổi lịch.'),
        toolCallStep('propose_cancel', { appointmentId: apptId, cancelReason: 'Đã đi khám ở nơi khác' }),
        textStep('Bấm Đồng ý để hủy.'),
      ]),
    );
    const sessionId = await newSession(patient);
    // Thiếu lý do đổi lịch: tool trả lỗi cho model, không tạo đề xuất.
    const missing = await send(patient, sessionId, 'Đổi sang 3 giờ chiều');
    expect(missing.body.pendingAction).toBeNull();

    const reschedule = (await send(patient, sessionId, 'Vì buổi sáng phải đi làm')).body.pendingAction;
    expect(reschedule).toMatchObject({
      type: 'RESCHEDULE',
      summary: { oldStartTime: vnIso(date, '08:00'), startTime: vnIso(date, '15:00'), changeReason: 'Buổi sáng phải đi làm' },
    });
    const confirmed = await request(app).post(`/api/chat/actions/${reschedule.id}/confirm`).set(authHeader(patient));
    // Lịch vẫn ở giờ cũ, yêu cầu đổi sang 15:00 đang chờ admin duyệt.
    expect(confirmed.body.appointment).toMatchObject({
      startTime: vnIso(date, '08:00'),
      pendingChange: { startTime: vnIso(date, '15:00'), reason: 'Buổi sáng phải đi làm' },
    });
    expect(confirmed.body.message.content).toContain('chờ phòng khám xác nhận');

    const cancel = (await send(patient, sessionId, 'Hủy lịch đó giúp tôi')).body.pendingAction;
    expect(cancel.type).toBe('CANCEL');
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: apptId } })).status).toBe(AppointmentStatus.CONFIRMED);
    await request(app).post(`/api/chat/actions/${cancel.id}/confirm`).set(authHeader(patient)).expect(200);
    const stored = await prisma.appointment.findUniqueOrThrow({ where: { id: apptId } });
    expect(stored.status).toBe(AppointmentStatus.CANCELLED);
    expect(stored.activeKey).toBeNull();
    expect(stored.cancelReason).toBe('Đã đi khám ở nơi khác');
    // Hủy lịch cũng bỏ yêu cầu đổi lịch đang chờ.
    expect(await prisma.appointment.count()).toBe(1);
  });
});

describe('An toàn', () => {
  it('get_my_appointments chỉ trả lịch của người đang chat, kể cả khi model truyền userId khác', async () => {
    const { doctor } = await createDoctor();
    const me = await createUser();
    const other = await createUser();
    const date = workingDate(2);
    await request(app).post('/api/appointments').set(authHeader(other)).send({ doctorId: doctor.id, startTime: vnIso(date, '08:00'), reason: 'Lý do riêng tư của người khác' });
    const llm = new ScriptedLlm([toolCallStep('get_my_appointments', { userId: other.id, patientId: other.id }), textStep('Bạn chưa có lịch hẹn.')]);
    setLlmClient(llm);
    const sessionId = await newSession(me);
    await send(me, sessionId, 'Lịch của tôi?').expect(200);
    const result = llm.requests[1]!.messages.at(-1)!.content as string;
    expect(JSON.parse(result)).toEqual({ appointments: [] });
    expect(result).not.toContain('riêng tư');
  });

  it('propose_cancel lịch của người khác trả lỗi cho model, không tạo đề xuất', async () => {
    const { doctor } = await createDoctor();
    const me = await createUser();
    const other = await createUser();
    const booked = await request(app)
      .post('/api/appointments')
      .set(authHeader(other))
      .send({ doctorId: doctor.id, startTime: vnIso(workingDate(2), '08:00'), reason: REASON });
    const llm = new ScriptedLlm([toolCallStep('propose_cancel', { appointmentId: booked.body.appointment.id, cancelReason: 'Không muốn khám nữa' }), textStep('Mình không thể hủy lịch này.')]);
    setLlmClient(llm);
    const sessionId = await newSession(me);
    const res = await send(me, sessionId, 'Hủy lịch kia');
    expect(res.body.pendingAction).toBeNull();
    expect(JSON.parse(llm.requests[1]!.messages.at(-1)!.content as string)).toMatchObject({ code: 'FORBIDDEN' });
    expect(await prisma.pendingAction.count()).toBe(0);
  });

  it('tham số sai được trả về dạng { error } để model giải thích lại', async () => {
    const patient = await createUser();
    const llm = new ScriptedLlm([toolCallStep('get_available_slots', { doctorId: 'abc', date: '14/11/2026' }), textStep('Ngày chưa đúng định dạng.')]);
    setLlmClient(llm);
    const sessionId = await newSession(patient);
    expect((await send(patient, sessionId, 'Xem lịch')).status).toBe(200);
    const result = JSON.parse(llm.requests[1]!.messages.at(-1)!.content as string);
    expect(result.error).toContain('Tham số không hợp lệ');
  });

  it('model không phản hồi trả LLM_UNAVAILABLE kèm lời nhắn dùng form', async () => {
    const patient = await createUser();
    setLlmClient(new ScriptedLlm([new Error('timeout')]));
    const sessionId = await newSession(patient);
    const res = await send(patient, sessionId, 'Xin chào');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('LLM_UNAVAILABLE');
    expect(res.body.error.message).toContain('form đặt lịch');
  });

  it('tối đa 6 vòng gọi model cho mỗi tin nhắn', async () => {
    const patient = await createUser();
    const llm = new ScriptedLlm(Array.from({ length: 10 }, () => toolCallStep('list_specialties', {})));
    setLlmClient(llm);
    const sessionId = await newSession(patient);
    const res = await send(patient, sessionId, 'Lặp mãi');
    expect(res.status).toBe(200);
    expect(llm.requests).toHaveLength(6);
    expect(res.body.message.content).toContain('quá nhiều bước');
  });

  it('tin nhắn tối đa 1.000 ký tự; người khác không đọc được phiên chat', async () => {
    const patient = await createUser();
    const other = await createUser();
    setLlmClient(new ScriptedLlm([]));
    const sessionId = await newSession(patient);
    const long = await send(patient, sessionId, 'a'.repeat(1001));
    expect(long.status).toBe(400);
    expect(long.body.error.message).toBe('Tin nhắn tối đa 1.000 ký tự.');
    expect((await request(app).get(`/api/chat/sessions/${sessionId}/messages`).set(authHeader(other))).status).toBe(403);
    expect((await send(other, sessionId, 'Xin chào')).status).toBe(403);
  });

  it('chỉ bệnh nhân dùng được chat', async () => {
    const admin = await createUser(Role.ADMIN);
    const doctor = await createUser(Role.DOCTOR);
    expect((await request(app).post('/api/chat/sessions').set(authHeader(admin)).send({})).status).toBe(403);
    expect((await request(app).post('/api/chat/sessions').set(authHeader(doctor)).send({})).status).toBe(403);
    expect((await request(app).post('/api/chat/sessions').send({})).status).toBe(401);
  });

  it('giới hạn 20 tin nhắn mỗi phút theo người dùng', async () => {
    const limitedApp = createApp();
    const patient = await createUser();
    setLlmClient(new ScriptedLlm(Array.from({ length: 25 }, () => textStep('Chào bạn'))));
    const sessionId = await newSession(patient);
    for (let i = 0; i < 20; i++) {
      await request(limitedApp).post(`/api/chat/sessions/${sessionId}/messages`).set(authHeader(patient)).send({ content: `Tin ${i}` }).expect(200);
    }
    const blocked = await request(limitedApp).post(`/api/chat/sessions/${sessionId}/messages`).set(authHeader(patient)).send({ content: 'Tin 21' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });
});
