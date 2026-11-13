// Kiểu dữ liệu trả về từ backend (/api).

export type Role = 'PATIENT' | 'DOCTOR' | 'ADMIN';
export type AppointmentStatus = 'CONFIRMED' | 'CANCELLED' | 'COMPLETED';
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
  totals: { appointments: number; confirmed: number; completed: number; cancelled: number; viaChatbot: number; viaForm: number };
  cancelRate: number;
  chatbotRate: number;
  bySpecialty: { specialtyId: string; name: string; total: number; confirmed: number; completed: number; cancelled: number }[];
  busiestSlots: { time: string; count: number }[];
}
