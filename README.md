# Website đặt lịch khám bệnh tích hợp AI Agent

Backend Node.js + TypeScript (Express, Prisma, MySQL) cho website đặt lịch khám, kèm một AI Agent đặt, đổi, hủy lịch ngay trong khung chat. Agent chạy vòng lặp tool calling trong backend: chỉ đọc dữ liệu thật qua tools và **đề xuất** thao tác ghi; lịch chỉ được ghi khi người dùng bấm Đồng ý.

```
backend/    API, Prisma schema, migrations, seed, test
frontend/   (chép frontend xuất từ Claude Artifacts vào đây)
```

## Yêu cầu

- Node.js 20 trở lên (đã thử với Node 24)
- MySQL 8 trở lên, charset utf8mb4 (đã thử với MySQL 9.3)
- Một model qua 9Router có hỗ trợ tool calling

## Cài đặt và chạy backend

```bash
cd backend
npm install
cp .env.example .env        # rồi điền các giá trị bên dưới
npm run db:deploy           # tạo database và bảng từ migrations
npm run db:seed             # dữ liệu mẫu, chạy lại nhiều lần không tạo trùng
npm run check:llm           # kiểm tra model 9Router có hỗ trợ tool calling
npm run dev                 # http://localhost:4000/api
```

Biến môi trường (`backend/.env`, xem `.env.example`). Server từ chối khởi động nếu thiếu biến bắt buộc.

| Biến | Ý nghĩa |
| --- | --- |
| `DATABASE_URL` | Chuỗi kết nối MySQL, ví dụ `mysql://root:matkhau@localhost:3306/clinic_booking` |
| `JWT_SECRET` | Khóa ký JWT, tối thiểu 32 ký tự |
| `PORT` | Cổng backend, mặc định 4000 |
| `FRONTEND_ORIGIN` | Origin được phép CORS (nhiều origin cách nhau bằng dấu phẩy) |
| `LLM_BASE_URL` | Địa chỉ API của 9Router (chuẩn OpenAI, thường kết thúc bằng `/v1`) |
| `LLM_API_KEY` | API key của 9Router |
| `LLM_MODEL` | Tên model, phải hỗ trợ tool calling |
| `CLINIC_NAME` | Tên phòng khám chèn vào system prompt |

Các lệnh khác: `npm test` (Vitest + Supertest), `npm run typecheck`, `npm run build && npm start`.

### Test

`npm test` dùng database riêng tên `<tên database>_test` trên cùng server (hoặc `TEST_DATABASE_URL` nếu đặt), được tạo lại từ migrations trước mỗi lần chạy. Test của agent dùng model giả lập, không gọi 9Router thật.

## Tài khoản mẫu (sau khi seed)

| Vai trò | Email | Mật khẩu |
| --- | --- | --- |
| Quản trị | `admin@phongkham.local` | `Admin@123456` |
| Bệnh nhân | `benhnhan1@example.com` (Nguyễn Thị Mai) | `Benhnhan@123` |
| Bệnh nhân | `benhnhan2@example.com` (Lê Văn Hùng) | `Benhnhan@123` |
| Bác sĩ (8 người) | `bs.an`, `bs.binh`, `bs.chau`, `bs.dung`, `bs.huy`, `bs.lan`, `bs.phong`, `bs.quynh` + `@phongkham.local` | `Bacsi@123456` |

Seed gồm 6 chuyên khoa (Nội tổng quát, Da liễu, Tai mũi họng, Nhi, Tim mạch, Răng hàm mặt), 8 bác sĩ làm việc thứ 2 đến thứ 7 (08:00-11:30, 13:30-17:00, khung 30 phút), 8 mục thông tin phòng khám và 10 lịch hẹn mẫu (5 đã khám, 2 sắp tới, 3 đã hủy; 4 lịch đặt qua chatbot) để trang thống kê có số liệu.

## API

Tất cả endpoint có tiền tố `/api`, nhận và trả JSON. Token gửi qua `Authorization: Bearer <token>`.

| Method và đường dẫn | Quyền | Mô tả |
| --- | --- | --- |
| `POST /auth/register` | Công khai | Tạo tài khoản bệnh nhân, trả `{ token, user }` |
| `POST /auth/login` | Công khai | Trả `{ token, user }`; tối đa 10 lần mỗi 15 phút theo IP |
| `GET /auth/me` | Đã đăng nhập | Người dùng hiện tại |
| `GET /specialties` | Công khai | Danh sách chuyên khoa |
| `GET /doctors?specialtyId=&q=` | Công khai | Tìm bác sĩ theo khoa hoặc tên |
| `GET /doctors/:id` | Công khai | Chi tiết bác sĩ kèm lịch làm việc |
| `GET /doctors/:id/slots?date=YYYY-MM-DD` | Công khai | Khung giờ còn trống trong ngày |
| `POST /appointments` | PATIENT | Đặt lịch: `doctorId`, `startTime`, `reason` |
| `GET /appointments/me?status=` | PATIENT, DOCTOR | Lịch hẹn của tôi |
| `PATCH /appointments/:id/reschedule` | PATIENT (chủ lịch) | Đổi sang `startTime` mới |
| `PATCH /appointments/:id/cancel` | PATIENT (chủ lịch) | Hủy lịch |
| `PATCH /appointments/:id/complete` | DOCTOR (bác sĩ của lịch) | Đánh dấu đã khám |
| `POST /chat/sessions` | PATIENT | Tạo phiên chat |
| `GET /chat/sessions` | PATIENT | Danh sách phiên của tôi |
| `GET /chat/sessions/:id/messages` | PATIENT (chủ phiên) | Lịch sử tin nhắn và đề xuất đang chờ |
| `POST /chat/sessions/:id/messages` | PATIENT (chủ phiên) | Gửi `{ content }`, nhận `{ message, pendingAction }`; tối đa 20 tin mỗi phút |
| `POST /chat/actions/:id/confirm` | PATIENT (chủ thao tác) | Xác nhận đề xuất |
| `POST /chat/actions/:id/reject` | PATIENT (chủ thao tác) | Từ chối đề xuất |
| `GET/POST/PATCH/DELETE /admin/specialties`, `/admin/doctors`, `/admin/schedules`, `/admin/clinic-info` | ADMIN | Quản lý dữ liệu nền |
| `GET /admin/stats` | ADMIN | Số lịch theo khoa, tỉ lệ hủy, khung giờ đông nhất, tỉ lệ đặt qua chatbot |

Lỗi luôn có dạng `{ "error": { "code": "SLOT_TAKEN", "message": "..." } }`, thông điệp tiếng Việt. Thời gian trả về dạng ISO 8601 theo giờ Việt Nam, ví dụ `2026-11-14T08:00:00+07:00`.

## Quyết định thiết kế

Những chỗ spec chưa nói rõ, chọn phương án đơn giản nhất:

1. **Múi giờ.** Việt Nam dùng UTC+7 cố định, không có giờ mùa hè, nên tính khung giờ bằng độ lệch cố định thay vì thư viện múi giờ. Database lưu UTC.
2. **Định dạng thời gian.** API trả thời gian dạng ISO 8601 kèm `+07:00`. Chuỗi gửi lên không có múi giờ được hiểu là giờ Việt Nam.
3. **Mã lỗi bổ sung** ngoài danh sách của spec: `CONFLICT` (409: email hoặc tên trùng, xóa dữ liệu đang được dùng), `INVALID_STATUS` (422: đổi/hủy lịch không ở trạng thái CONFIRMED, xác nhận đề xuất đã xử lý), `BOOKING_LIMIT` (422: bệnh nhân trùng giờ hoặc đã có 3 lịch sắp tới), `ACTION_EXPIRED` (422: đề xuất quá 10 phút), `INTERNAL_ERROR` (500).
4. **SLOT_TAKEN và SLOT_INVALID.** Giờ không nằm trên lưới khung giờ, trong vòng 60 phút tới hoặc quá 30 ngày → `SLOT_INVALID`. Giờ đúng lưới nhưng đã có người đặt → `SLOT_TAKEN`. Thứ tự kiểm tra: lưới khung giờ → khung còn trống → giới hạn của bệnh nhân → insert.
5. **Chống đặt trùng.** Lớp cuối là unique index `(doctorId, startTime, activeKey)` ở database; vi phạm (Prisma `P2002`) trả `SLOT_TAKEN`. Transaction đặt/đổi/hủy dùng mức cô lập READ COMMITTED và khóa dòng của bệnh nhân (`SELECT ... FOR UPDATE`) để kiểm tra "không trùng giờ, tối đa 3 lịch" không bị chạy đua; xung đột ghi (`P2034`) được thử lại tối đa 3 lần.
6. **Khung giờ trống** cũng ẩn các ngày quá 30 ngày tới, để không hiển thị khung không đặt được.
7. **Xóa dữ liệu nền.** Chuyên khoa còn bác sĩ thì từ chối xóa (không xóa dây chuyền). Bác sĩ chưa có lịch hẹn nào thì xóa cả lịch làm việc và tài khoản; có lịch hẹn thì từ chối.
8. **ClinicInfo.topic là unique** để seed upsert được, không tạo trùng.
9. **Tên bảng snake_case** (`users`, `appointments`, ...) vì MySQL trên Windows mặc định không phân biệt hoa thường tên bảng.
10. **Xác nhận đề xuất thất bại** (ví dụ `SLOT_TAKEN`): đề xuất chuyển sang EXPIRED, lỗi trả theo định dạng thống nhất kèm `error.details.message` là tin nhắn đã lưu vào phiên. Lỗi hệ thống (không phải lỗi nghiệp vụ) trả đề xuất về PENDING để người dùng thử lại. Bấm Đồng ý hai lần chỉ thực hiện một lần.
11. **Lịch sử gửi model** được dựng một lần mỗi lượt từ 20 tin nhắn gần nhất rồi nối thêm các lời gọi tool trong lượt; bỏ các tin nhắn đầu không phải của user và các nhóm lời gọi tool thiếu kết quả để request luôn hợp lệ.
12. **System prompt** giữ nguyên văn mẫu của spec; giá trị `{NGAY_GIO}` có thêm danh sách 7 ngày tới (thứ ↔ ngày) để model đổi "sáng thứ 7" thành ngày cụ thể.
13. **Endpoint bổ sung** `GET /chat/sessions` để frontend mở lại phiên cũ. `GET /chat/sessions/:id/messages` trả thêm `pendingAction` đang chờ để khôi phục thẻ xác nhận khi tải lại trang.
14. **Đăng ký trả token** để bệnh nhân đăng nhập luôn sau khi đăng ký.
15. **Thông tin công khai của bác sĩ** không gồm email và số điện thoại.
16. **Đánh dấu đã khám** không giới hạn thời điểm; chỉ yêu cầu lịch đang CONFIRMED và thuộc bác sĩ đó.
17. **Prisma 6** thay vì Prisma 7, vì Prisma 7 bắt buộc driver adapter và file cấu hình mới. `npm audit` cảnh báo `deepmerge-ts` trong Prisma CLI; gói này chỉ dùng lúc phát triển.
