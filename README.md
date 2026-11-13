# Website đặt lịch khám bệnh tích hợp AI Agent

Website đặt lịch khám gồm backend Node.js + TypeScript (Express, Prisma, MySQL) và frontend React + Vite, kèm một AI Agent đặt, đổi, hủy lịch ngay trong khung chat. Agent chạy vòng lặp tool calling trong backend: chỉ đọc dữ liệu thật qua tools và **đề xuất** thao tác ghi; lịch chỉ được ghi khi người dùng bấm Đồng ý.

```
backend/    API, Prisma schema, migrations, seed, test
frontend/   React + Vite + TypeScript, dựng theo bản thiết kế "Phòng khám An Tâm" trên Claude Artifacts
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

`npm test` dùng database riêng tên `<tên database>_test` trên cùng server (hoặc `TEST_DATABASE_URL` nếu đặt). Trước khi chạy, migrations được áp vào database đó (`prisma migrate deploy`); mỗi file test tự xóa dữ liệu của database test, và chỉ chạy được trên database có tên kết thúc bằng `_test`. Test của agent dùng model giả lập, không gọi 9Router thật.

## Cài đặt và chạy frontend

```bash
cd frontend
npm install
cp .env.example .env        # VITE_API_URL=http://localhost:4000/api
npm run dev                 # http://localhost:5173
```

`npm run build` kiểm tra kiểu (TypeScript strict) rồi build ra `frontend/dist`. Backend phải cho phép origin của frontend trong `FRONTEND_ORIGIN`.

| Trang | Ai dùng | Nội dung |
| --- | --- | --- |
| `/` | Mọi người | Trang chủ, đặt lịch nhanh (xem giờ trống không cần đăng nhập), chuyên khoa, bác sĩ |
| `/bac-si` | Mọi người | Tìm bác sĩ theo khoa hoặc tên |
| `/dat-lich` | Bệnh nhân | Chọn khoa → bác sĩ → ngày → khung giờ → lý do |
| `/lich-hen` | Bệnh nhân | Lịch hẹn của tôi, đổi và hủy lịch |
| `/lich-kham` | Bác sĩ, Quản trị | Lịch theo Ngày / Tuần / Tháng / Danh sách; bác sĩ đánh dấu đã khám |
| `/quan-tri` | Quản trị | Thống kê, chuyên khoa, bác sĩ, lịch làm việc, thông tin phòng khám |
| Khung chat | Bệnh nhân | Trợ lý AI ở góc phải; mở toàn màn hình trên điện thoại |

Màu và kích thước khai báo một chỗ ở `frontend/src/styles/tokens.css` (spec mục 8.1); các file CSS khác chỉ dùng biến.

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
| `POST /chat/sessions/:id/messages` | PATIENT (chủ phiên) | Gửi `{ content }`, nhận `{ message, pendingAction, slotOptions }`; tối đa 20 tin mỗi phút |
| `POST /chat/actions/:id/confirm` | PATIENT (chủ thao tác) | Xác nhận đề xuất |
| `POST /chat/actions/:id/reject` | PATIENT (chủ thao tác) | Từ chối đề xuất |
| `GET/POST/PATCH/DELETE /admin/specialties`, `/admin/doctors`, `/admin/schedules`, `/admin/clinic-info` | ADMIN | Quản lý dữ liệu nền |
| `GET /admin/appointments?from=&to=&doctorId=&status=` | ADMIN | Lịch hẹn của mọi bác sĩ trong khoảng ngày (tối đa 62 ngày), không có lý do khám |
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
18. **Bản thiết kế frontend** là một artifact dạng Design (mockup HTML, dữ liệu giả) chứ không phải mã nguồn. Frontend được dựng lại bằng React + Vite, giữ bố cục và các màn hình của thiết kế, làm lại style theo mục 8.1 (màu nhấn `#0061ff`, font hệ thống, không tải font ngoài).
19. **Màn hình "Lịch khám"** trong thiết kế dành cho vai trò Lễ tân, với các trạng thái Chờ xác nhận / Check-in / Vắng mặt và nút "Đặt lịch hộ". Spec không có vai trò này, nên các màn hình Ngày / Tuần / Tháng / Danh sách dùng cho Quản trị (mọi bác sĩ) và Bác sĩ (lịch của mình), chỉ với 3 trạng thái của spec. Bỏ check-in, chờ xác nhận, vắng mặt, đặt lịch hộ.
20. **Nút chọn giờ trong khung chat** (có trong thiết kế): response của chat trả thêm `slotOptions`, là các khung giờ trống agent vừa tra trong lượt đó. Bấm một nút sẽ gửi giờ đó cho agent như một tin nhắn; agent vẫn phải gọi `propose_booking` và người dùng vẫn phải bấm Đồng ý. Không trả `slotOptions` khi đã có đề xuất chờ xác nhận.
21. **Bỏ các tính năng ngoài spec** của thiết kế: đặt lịch hộ người thân, nút "Gặp nhân viên" (giữ link gọi hotline).
22. **Cảnh báo cấp cứu trong chat**: tin nhắn của trợ lý được hiển thị dạng thẻ đỏ kèm nút "Gọi 115 ngay" khi đoạn mở đầu của nó khuyên gọi 115. Nội dung vẫn do agent quyết định theo system prompt.
23. **Phiên chat**: mở khung chat sẽ dùng lại phiên gần nhất nếu phiên đó có hoạt động trong 12 giờ qua, nếu không thì tạo phiên mới; có nút "Cuộc trò chuyện mới". Đặt lịch qua chat xong, trang "Lịch hẹn của tôi" tự tải lại qua một tín hiệu dùng chung trong frontend.
24. **Thông tin ở chân trang** (địa chỉ, giờ làm việc, hotline 1900 0000) viết cố định khớp với dữ liệu seed, vì API thông tin phòng khám chỉ dành cho admin.
25. **Thống kê** dùng ô số liệu cho tổng số và các tỉ lệ, cùng thanh ngang một màu cho số lịch theo khoa và theo khung giờ; mỗi thanh có nhãn giá trị và tooltip.
