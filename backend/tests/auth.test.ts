import request from 'supertest';
import { Role } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { TEST_PASSWORD, authHeader, createUser, resetDb } from './helpers.js';

const app = createApp();

beforeAll(resetDb);
afterAll(() => prisma.$disconnect());

describe('Đăng ký', () => {
  it('tạo tài khoản PATIENT, trả token và không trả passwordHash', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'Moi@Test.Local', password: 'matkhau123', fullName: 'Bệnh nhân Mới', role: 'ADMIN' });
    expect(res.status).toBe(201);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ email: 'moi@test.local', role: 'PATIENT', fullName: 'Bệnh nhân Mới' });
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    const stored = await prisma.user.findUniqueOrThrow({ where: { email: 'moi@test.local' } });
    expect(stored.role).toBe(Role.PATIENT);
    expect(stored.passwordHash).not.toBe('matkhau123');
    expect(stored.passwordHash.startsWith('$2b$10$')).toBe(true);
  });

  it('từ chối mật khẩu ngắn hơn 8 ký tự với định dạng lỗi thống nhất', async () => {
    const res = await request(app).post('/api/auth/register').send({ email: 'ngan@test.local', password: '1234567', fullName: 'Ngắn' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'VALIDATION_ERROR', message: 'Mật khẩu cần ít nhất 8 ký tự.' });
  });

  it('từ chối email đã tồn tại', async () => {
    const res = await request(app).post('/api/auth/register').send({ email: 'moi@test.local', password: 'matkhau123', fullName: 'Trùng email' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });
});

describe('Đăng nhập', () => {
  it('sai mật khẩu bị từ chối', async () => {
    const user = await createUser(Role.PATIENT);
    const res = await request(app).post('/api/auth/login').send({ email: user.email, password: 'sai-mat-khau' });
    expect(res.status).toBe(401);
    expect(res.body.error).toEqual({ code: 'UNAUTHORIZED', message: 'Email hoặc mật khẩu không đúng.' });
  });

  it('email không tồn tại trả cùng thông báo', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'khongco@test.local', password: TEST_PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Email hoặc mật khẩu không đúng.');
  });

  it('đúng mật khẩu trả token dùng được cho /auth/me', async () => {
    const user = await createUser(Role.PATIENT);
    const login = await request(app).post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD });
    expect(login.status).toBe(200);
    expect(JSON.stringify(login.body)).not.toContain('passwordHash');
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${login.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ id: user.id, role: 'PATIENT' });
    expect(JSON.stringify(me.body)).not.toContain('passwordHash');
  });

  it('thiếu hoặc sai token trả 401', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    const bad = await request(app).get('/api/auth/me').set('Authorization', 'Bearer khong-hop-le');
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('UNAUTHORIZED');
  });

  it('giới hạn 10 lần đăng nhập mỗi 15 phút theo IP', async () => {
    const limitedApp = createApp();
    for (let i = 0; i < 10; i++) {
      const res = await request(limitedApp).post('/api/auth/login').send({ email: 'khongco@test.local', password: 'x' });
      expect(res.status).toBe(401);
    }
    const blocked = await request(limitedApp).post('/api/auth/login').send({ email: 'khongco@test.local', password: 'x' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('Phân quyền', () => {
  it('bệnh nhân gọi /admin/* nhận 403', async () => {
    const patient = await createUser(Role.PATIENT);
    for (const path of ['/api/admin/stats', '/api/admin/specialties', '/api/admin/doctors', '/api/admin/schedules', '/api/admin/clinic-info']) {
      const res = await request(app).get(path).set(authHeader(patient));
      expect(res.status, path).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    const post = await request(app).post('/api/admin/specialties').set(authHeader(patient)).send({ name: 'X', description: 'Y', symptomHints: 'Z' });
    expect(post.status).toBe(403);
  });

  it('bác sĩ cũng không vào được /admin/*', async () => {
    const doctor = await createUser(Role.DOCTOR);
    expect((await request(app).get('/api/admin/stats').set(authHeader(doctor))).status).toBe(403);
  });

  it('chưa đăng nhập gọi /admin/* nhận 401', async () => {
    expect((await request(app).get('/api/admin/stats')).status).toBe(401);
  });


  it('đường dẫn không tồn tại trả NOT_FOUND', async () => {
    const res = await request(app).get('/api/khong-co');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
