// Kiểu dữ liệu trả về từ backend (/api).

export type Role = 'PATIENT' | 'DOCTOR' | 'ADMIN';
/** PENDING chỉ có ở khung giờ đang giữ chỗ cho một yêu cầu đổi lịch chờ admin duyệt. */
export type AppointmentStatus = 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'PENDING';
export type CreatedVia = 'FORM' | 'CHATBOT';

export interface User {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: Role;
  doctorId: string | null;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface Specialty {
  id: string;
  name: string;
  description: string;
  symptomHints: string;
}

export interface WorkingSchedule {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface Doctor {
  id: string;
  fullName: string;
  specialty: { id: string; name: string };
  bio: string;
  fee: number;
  slotMinutes: number;
  schedules: WorkingSchedule[];
}

export interface AdminDoctor extends Doctor {
  email: string;
  phone: string | null;
  appointmentCount: number;
}

export interface Slot {
  startTime: string;
  endTime: string;
  time: string;
}

export interface Appointment {
  id: string;
  startTime: string;
  endTime: string;
  reason: string;
  status: AppointmentStatus;
  createdVia: CreatedVia;
  createdAt: string;
  /** Khác null khi đây là khung giữ chỗ của một yêu cầu đổi lịch (chỉ bác sĩ thấy). */
  rescheduleOfId: string | null;
  /** Yêu cầu đổi lịch đang chờ admin duyệt. */
  pendingChange: { startTime: string; endTime: string; reason: string; requestedAt: string } | null;
  /** Lý do của lần đổi lịch đã được duyệt gần nhất. */
  changeReason: string | null;
  previousStartTime: string | null;
  /** Lần từ chối đổi lịch gần nhất. */
  changeRejection: { requestedStartTime: string; reason: string; at: string } | null;
  cancelReason: string | null;
  doctor: { id: string; fullName: string; fee: number; specialty: { id: string; name: string } };
  patient: { id: string; fullName: string; phone: string | null };
}

/** Lịch hẹn admin xem được: không có lý do khám. */
export interface AdminAppointment {
  id: string;
  startTime: string;
  endTime: string;
  status: AppointmentStatus;
  createdVia: CreatedVia;
  rescheduleOfId: string | null;
  changeReason: string | null;
  doctor: { id: string; fullName: string; specialty: { id: string; name: string } };
  patient: { id: string; fullName: string; phone: string | null };
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface PendingActionSummary {
  title: string;
  doctorName: string;
  specialtyName: string;
  startTime: string;
  startTimeText: string;
  oldStartTime?: string;
  oldStartTimeText?: string;
  reason: string;
  /** Lý do đổi hoặc hủy lịch. */
  changeReason?: string;
  fee?: number;
}

export interface PendingAction {
  id: string;
  type: 'CREATE' | 'RESCHEDULE' | 'CANCEL';
  status: 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'EXPIRED';
  expiresAt: string;
  summary: PendingActionSummary;
}

export interface SlotGroup {
  doctorId: string;
  doctorName: string;
  specialtyName: string;
  date: string;
  dateText: string;
  slots: { startTime: string; time: string }[];
}

export interface AgentReply {
  message: ChatMessage;
  pendingAction: PendingAction | null;
  slotOptions: SlotGroup[];
}

export interface ClinicInfo {
  id: string;
  topic: string;
  content: string;
}

export interface Stats {
  totals: {
    appointments: number;
    confirmed: number;
    completed: number;
    cancelled: number;
    viaChatbot: number;
    viaForm: number;
    pendingReschedules: number;
  };
  cancelRate: number;
  chatbotRate: number;
  bySpecialty: { specialtyId: string; name: string; total: number; confirmed: number; completed: number; cancelled: number }[];
  busiestSlots: { time: string; count: number }[];
}

/** Yêu cầu đổi lịch chờ admin duyệt (không có lý do khám). */
export interface RescheduleRequest {
  appointmentId: string;
  patient: { id: string; fullName: string; phone: string | null };
  doctor: { id: string; fullName: string; specialty: { id: string; name: string } };
  currentStartTime: string;
  requestedStartTime: string;
  requestedEndTime: string;
  changeReason: string;
  requestedAt: string;
  createdVia: CreatedVia;
}

/** Một lịch khám trên lịch công khai: chỉ bác sĩ, chuyên khoa và giờ (không có bệnh nhân). */
export interface CalendarEvent {
  startTime: string;
  endTime: string;
  /** BOOKED: đã có người đặt; HELD: đang giữ chỗ cho yêu cầu đổi lịch; COMPLETED: đã khám. */
  state: 'BOOKED' | 'HELD' | 'COMPLETED';
  doctor: { id: string; fullName: string };
  specialty: { id: string; name: string };
}
