import { testDatabaseUrl } from './test-db.js';

// Chạy trước mỗi file test, trước khi app đọc biến môi trường.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testDatabaseUrl();
process.env.JWT_SECRET = 'test-secret-key-that-is-long-enough-1234567890';
process.env.FRONTEND_ORIGIN = 'http://localhost:5173';
process.env.CLINIC_NAME = 'Phòng khám Test';
// Test không bao giờ gọi 9Router thật: các giá trị giả, agent dùng model giả lập.
process.env.LLM_BASE_URL = 'http://llm.invalid/v1';
process.env.LLM_API_KEY = 'test-key';
process.env.LLM_MODEL = 'fake-model';
