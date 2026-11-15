/**
 * Seed dữ liệu mẫu. Chạy lại nhiều lần không tạo trùng:
 * người dùng, chuyên khoa, bác sĩ, ClinicInfo được upsert theo khóa unique;
 * lịch làm việc được ghi lại; lịch hẹn mẫu chỉ tạo khi bệnh nhân mẫu chưa có lịch nào.
 */
import bcrypt from 'bcrypt';
import { AppointmentStatus, CreatedVia, PrismaClient, Role } from '@prisma/client';
import { DAY_MS, MINUTE_MS, timeToMinutes, toVnDateString, vnDateMinutesToUtc, vnDayOfWeek } from '../src/lib/time.js';

const prisma = new PrismaClient();
const BCRYPT_COST = 10;

export const SEED_ACCOUNTS = {
  admin: { email: 'admin@phongkham.local', password: 'Admin@123456', fullName: 'Quản trị viên' },
  patients: [
    { email: 'benhnhan1@example.com', password: 'Benhnhan@123', fullName: 'Nguyễn Thị Mai', phone: '0901234567' },
    { email: 'benhnhan2@example.com', password: 'Benhnhan@123', fullName: 'Lê Văn Hùng', phone: '0912345678' },
  ],
  doctorPassword: 'Bacsi@123456',
};

const SPECIALTIES = [
  {
    name: 'Nội tổng quát',
    description: 'Khám và theo dõi các bệnh lý nội khoa thường gặp ở người lớn, khám sức khỏe tổng quát.',
    symptomHints: 'sốt, mệt mỏi, đau đầu, chóng mặt, đau bụng, tiêu chảy, táo bón, ợ chua, ho kéo dài, tăng huyết áp, tiểu đường, khám sức khỏe định kỳ',
  },
  {
    name: 'Da liễu',
    description: 'Chẩn đoán và điều trị các bệnh về da, tóc, móng.',
    symptomHints: 'nổi mẩn, ngứa da, mụn trứng cá, dị ứng da, nấm da, chàm, vảy nến, rụng tóc, nám, tàn nhang, mề đay',
  },
  {
    name: 'Tai mũi họng',
    description: 'Khám và điều trị các bệnh lý tai, mũi, họng, xoang.',
    symptomHints: 'đau họng, ho, khàn tiếng, ù tai, đau tai, nghe kém, chảy mũi, nghẹt mũi, viêm xoang, chảy máu cam, ngủ ngáy',
  },
  {
    name: 'Nhi',
    description: 'Khám sức khỏe và bệnh lý cho trẻ em từ sơ sinh đến 15 tuổi.',
    symptomHints: 'trẻ sốt, trẻ ho, trẻ biếng ăn, tiêu chảy ở trẻ, phát ban ở trẻ, chậm tăng cân, tiêm chủng, khám định kỳ cho bé',
  },
  {
    name: 'Tim mạch',
    description: 'Khám, tầm soát và theo dõi các bệnh lý tim mạch, huyết áp.',
    symptomHints: 'hồi hộp, đánh trống ngực, tim đập nhanh, khó thở khi gắng sức, đau tức ngực nhẹ, tăng huyết áp, phù chân, mỡ máu cao',
  },
  {
    name: 'Răng hàm mặt',
    description: 'Khám, điều trị và chăm sóc răng miệng.',
    symptomHints: 'đau răng, sâu răng, ê buốt răng, chảy máu chân răng, hôi miệng, viêm lợi, mọc răng khôn, cạo vôi răng, răng lung lay',
  },
];

const DOCTORS = [
  { email: 'bs.an@phongkham.local', fullName: 'Nguyễn Văn An', specialty: 'Nội tổng quát', fee: 200_000, bio: 'Bác sĩ chuyên khoa I Nội tổng quát, 12 năm kinh nghiệm khám và quản lý bệnh mạn tính.' },
  { email: 'bs.binh@phongkham.local', fullName: 'Trần Thị Bình', specialty: 'Nội tổng quát', fee: 200_000, bio: 'Thạc sĩ, bác sĩ Nội khoa, có thế mạnh về tiêu hóa và khám sức khỏe định kỳ.' },
  { email: 'bs.chau@phongkham.local', fullName: 'Lê Minh Châu', specialty: 'Da liễu', fee: 250_000, bio: 'Bác sĩ chuyên khoa Da liễu, điều trị mụn, viêm da cơ địa và bệnh da dị ứng.' },
  { email: 'bs.dung@phongkham.local', fullName: 'Phạm Thu Dung', specialty: 'Da liễu', fee: 250_000, bio: 'Bác sĩ Da liễu, 8 năm kinh nghiệm về nấm da, vảy nến và chăm sóc da.' },
  { email: 'bs.huy@phongkham.local', fullName: 'Hoàng Quốc Huy', specialty: 'Tai mũi họng', fee: 220_000, bio: 'Bác sĩ chuyên khoa I Tai mũi họng, chuyên nội soi và điều trị viêm xoang.' },
  { email: 'bs.lan@phongkham.local', fullName: 'Võ Ngọc Lan', specialty: 'Nhi', fee: 200_000, bio: 'Bác sĩ Nhi khoa, 10 năm kinh nghiệm chăm sóc sức khỏe trẻ em.' },
  { email: 'bs.phong@phongkham.local', fullName: 'Đặng Thanh Phong', specialty: 'Tim mạch', fee: 300_000, bio: 'Thạc sĩ, bác sĩ Tim mạch, tầm soát và theo dõi tăng huyết áp, rối loạn nhịp.' },
  { email: 'bs.quynh@phongkham.local', fullName: 'Bùi Mai Quỳnh', specialty: 'Răng hàm mặt', fee: 180_000, bio: 'Bác sĩ Răng hàm mặt, điều trị tủy, nhổ răng khôn và nha khoa thẩm mỹ.' },
];

// Thứ 2 đến thứ 7, sáng 08:00-11:30 và chiều 13:30-17:00.
const WORKING_DAYS = [1, 2, 3, 4, 5, 6];
const WORKING_HOURS = [
  { startTime: '08:00', endTime: '11:30' },
  { startTime: '13:30', endTime: '17:00' },
];

const CLINIC_INFO = [
  { topic: 'Giờ làm việc', content: 'Phòng khám làm việc từ thứ 2 đến thứ 7. Buổi sáng 08:00-11:30, buổi chiều 13:30-17:00. Nghỉ Chủ nhật và các ngày lễ, Tết.' },
  { topic: 'Địa chỉ', content: 'Số 123 đường Lê Lợi, phường Bến Thành, Quận 1, TP. Hồ Chí Minh. Hotline: 1900 0000 (giờ hành chính).' },
  { topic: 'Bảng giá khám', content: 'Phí khám (chưa gồm xét nghiệm, thuốc): Nội tổng quát 200.000đ, Nhi 200.000đ, Tai mũi họng 220.000đ, Da liễu 250.000đ, Tim mạch 300.000đ, Răng hàm mặt 180.000đ. Xét nghiệm máu cơ bản từ 150.000đ.' },
  { topic: 'Quy định hủy và đổi lịch', content: 'Bạn có thể đổi hoặc hủy lịch miễn phí trước giờ khám ít nhất 2 giờ, trên website hoặc qua trợ lý chat, kèm lý do. Hủy lịch có hiệu lực ngay; đổi lịch cần phòng khám xác nhận, trong lúc chờ lịch cũ vẫn được giữ. Mỗi người tối đa 3 lịch hẹn sắp tới. Đến trễ quá 15 phút, lịch có thể được chuyển sang khung giờ trống kế tiếp.' },
  { topic: 'Hướng dẫn trước xét nghiệm máu', content: 'Nhịn ăn 8-10 tiếng trước khi xét nghiệm đường huyết, mỡ máu (được uống nước lọc). Không uống rượu bia 24 giờ trước. Nên lấy máu vào buổi sáng, mang theo đơn thuốc đang dùng.' },
  { topic: 'Bảo hiểm', content: 'Phòng khám nhận bảo hiểm y tế theo quy định và bảo lãnh viện phí của một số công ty bảo hiểm sức khỏe. Vui lòng xuất trình thẻ bảo hiểm tại quầy tiếp đón trước khi khám.' },
  { topic: 'Giấy tờ cần mang', content: 'Mang theo CCCD hoặc giấy tờ tùy thân, thẻ bảo hiểm (nếu có), kết quả khám và đơn thuốc cũ liên quan. Với trẻ em, mang giấy khai sinh hoặc thẻ bảo hiểm của bé và sổ tiêm chủng.' },
  { topic: 'Bãi gửi xe', content: 'Bãi gửi xe máy miễn phí ngay tầng hầm phòng khám. Ô tô gửi tại bãi xe công cộng cách 100m, phí theo quy định của bãi.' },
];

/** Ngày làm việc (thứ 2-7) thứ |offset| tính từ hôm nay, theo giờ Việt Nam; offset âm là quá khứ. */
function workingDay(now: Date, offset: number): string {
  const todayStart = vnDateMinutesToUtc(toVnDateString(now), 0).getTime();
  const step = offset >= 0 ? 1 : -1;
  let cursor = todayStart;
  let count = 0;
  while (count < Math.abs(offset)) {
    cursor += step * DAY_MS;
    if (vnDayOfWeek(toVnDateString(new Date(cursor))) !== 0) count++;
  }
  return toVnDateString(new Date(cursor));
}

async function upsertUser(data: { email: string; password: string; fullName: string; phone?: string; role: Role }) {
  const passwordHash = await bcrypt.hash(data.password, BCRYPT_COST);
  return prisma.user.upsert({
    where: { email: data.email },
    update: { passwordHash, fullName: data.fullName, phone: data.phone ?? null, role: data.role },
    create: { email: data.email, passwordHash, fullName: data.fullName, phone: data.phone ?? null, role: data.role },
  });
}

async function main() {
  const now = new Date();

  await upsertUser({ ...SEED_ACCOUNTS.admin, role: Role.ADMIN });
  const patients = await Promise.all(SEED_ACCOUNTS.patients.map((p) => upsertUser({ ...p, role: Role.PATIENT })));

  const specialtyIds = new Map<string, string>();
  for (const s of SPECIALTIES) {
    const row = await prisma.specialty.upsert({ where: { name: s.name }, update: s, create: s });
    specialtyIds.set(s.name, row.id);
  }

  const doctorIds = new Map<string, string>();
  for (const d of DOCTORS) {
    const user = await upsertUser({ email: d.email, password: SEED_ACCOUNTS.doctorPassword, fullName: d.fullName, role: Role.DOCTOR });
    const data = { specialtyId: specialtyIds.get(d.specialty)!, bio: d.bio, fee: d.fee, slotMinutes: 30 };
    const doctor = await prisma.doctor.upsert({ where: { userId: user.id }, update: data, create: { userId: user.id, ...data } });
    doctorIds.set(d.fullName, doctor.id);
    await prisma.workingSchedule.deleteMany({ where: { doctorId: doctor.id } });
    await prisma.workingSchedule.createMany({
      data: WORKING_DAYS.flatMap((dayOfWeek) => WORKING_HOURS.map((h) => ({ doctorId: doctor.id, dayOfWeek, ...h }))),
    });
  }

  for (const info of CLINIC_INFO) {
    await prisma.clinicInfo.upsert({ where: { topic: info.topic }, update: { content: info.content }, create: info });
  }

  const [p1, p2] = patients as [(typeof patients)[number], (typeof patients)[number]];
  const existing = await prisma.appointment.count({ where: { patientId: { in: [p1.id, p2.id] } } });
  if (existing === 0) {
    const samples = [
      { patient: p1, doctor: 'Nguyễn Văn An', day: -10, time: '08:00', status: AppointmentStatus.COMPLETED, via: CreatedVia.FORM, reason: 'Sốt nhẹ và mệt mỏi kéo dài 3 ngày' },
      { patient: p1, doctor: 'Lê Minh Châu', day: -7, time: '09:00', status: AppointmentStatus.COMPLETED, via: CreatedVia.CHATBOT, reason: 'Nổi mẩn đỏ, ngứa ở hai cánh tay' },
      { patient: p2, doctor: 'Hoàng Quốc Huy', day: -6, time: '14:00', status: AppointmentStatus.COMPLETED, via: CreatedVia.FORM, reason: 'Đau họng, nuốt vướng gần một tuần' },
      { patient: p2, doctor: 'Võ Ngọc Lan', day: -5, time: '08:30', status: AppointmentStatus.CANCELLED, via: CreatedVia.CHATBOT, reason: 'Khám cho bé bị ho và sổ mũi' },
      { patient: p1, doctor: 'Đặng Thanh Phong', day: -4, time: '10:00', status: AppointmentStatus.COMPLETED, via: CreatedVia.FORM, reason: 'Hồi hộp, tim đập nhanh khi leo cầu thang' },
      { patient: p2, doctor: 'Bùi Mai Quỳnh', day: -3, time: '15:00', status: AppointmentStatus.CANCELLED, via: CreatedVia.FORM, reason: 'Đau răng hàm dưới bên phải' },
      { patient: p1, doctor: 'Trần Thị Bình', day: -2, time: '09:00', status: AppointmentStatus.COMPLETED, via: CreatedVia.CHATBOT, reason: 'Đau bụng âm ỉ sau khi ăn' },
      { patient: p1, doctor: 'Phạm Thu Dung', day: 3, time: '08:00', status: AppointmentStatus.CONFIRMED, via: CreatedVia.FORM, reason: 'Tái khám viêm da cơ địa' },
      { patient: p2, doctor: 'Hoàng Quốc Huy', day: 4, time: '14:30', status: AppointmentStatus.CONFIRMED, via: CreatedVia.CHATBOT, reason: 'Ù tai bên trái khoảng một tuần' },
      { patient: p2, doctor: 'Nguyễn Văn An', day: 5, time: '10:00', status: AppointmentStatus.CANCELLED, via: CreatedVia.FORM, reason: 'Khám sức khỏe tổng quát định kỳ' },
    ];
    for (const s of samples) {
      const startTime = vnDateMinutesToUtc(workingDay(now, s.day), timeToMinutes(s.time));
      await prisma.appointment.create({
        data: {
          patientId: s.patient.id,
          doctorId: doctorIds.get(s.doctor)!,
          startTime,
          endTime: new Date(startTime.getTime() + 30 * MINUTE_MS),
          reason: s.reason,
          status: s.status,
          createdVia: s.via,
          activeKey: s.status === AppointmentStatus.CANCELLED ? null : 1,
        },
      });
    }
    console.info(`Đã tạo ${samples.length} lịch hẹn mẫu.`);
  } else {
    console.info('Bệnh nhân mẫu đã có lịch hẹn, bỏ qua bước tạo lịch hẹn mẫu.');
  }

  const counts = {
    users: await prisma.user.count(),
    specialties: await prisma.specialty.count(),
    doctors: await prisma.doctor.count(),
    schedules: await prisma.workingSchedule.count(),
    clinicInfo: await prisma.clinicInfo.count(),
    appointments: await prisma.appointment.count(),
  };
  console.info('Seed xong:', counts);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
