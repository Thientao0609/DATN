/**
 * Đặt lịch nhanh: chọn bác sĩ, rồi chọn ngày trên lịch và khung giờ còn trống.
 * Bố cục theo component "CalendarScheduler" (thiết kế của ruixen.com), chuyển sang
 * hệ kiểu dáng của dự án và dữ liệu thật từ API.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../lib/api';
import { addDays, formatDateTime, longDate, todayVn } from '../lib/time';
import type { Doctor, Slot } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { Calendar } from './Calendar';
import { ErrorAlert, Spinner } from './common';
import { defaultBookingDate } from './SlotPicker';

/** Chỉ đặt được trong vòng 30 ngày tới (quy tắc của backend). */
const MAX_DAYS_AHEAD = 30;

const pad = (n: number) => String(n).padStart(2, '0');
/** Ngày trên lịch (giờ máy) ↔ YYYY-MM-DD. Người dùng chọn một ngày lịch, hiểu theo giờ Việt Nam. */
const toYmd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromYmd = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
};

function TimeSlots({ doctorId, date, value, onChange }: { doctorId: string; date: string; value: Slot | null; onChange: (s: Slot) => void }) {
  const slots = useAsync((signal) => api.get<{ slots: Slot[] }>(`/doctors/${doctorId}/slots`, { date }, signal), [doctorId, date]);
  const groups = useMemo(() => {
    const list = slots.data?.slots ?? [];
    return [
      { label: 'Buổi sáng', items: list.filter((s) => s.time < '12:00') },
      { label: 'Buổi chiều', items: list.filter((s) => s.time >= '12:00') },
    ].filter((g) => g.items.length > 0);
  }, [slots.data]);

  if (slots.loading && !slots.data) return <Spinner label="Đang tải giờ trống" />;
  if (slots.error) return <ErrorAlert message={slots.error} />;
  if (groups.length === 0) return <p className="scheduler-empty">Ngày này không còn giờ trống. Bạn chọn ngày khác nhé.</p>;
  return (
    <div className="stack">
      {groups.map((g) => (
        <div key={g.label} className="field">
          <span className="field-hint">{g.label}</span>
          <div className="time-grid" role="group" aria-label={`Giờ trống ${g.label.toLowerCase()}`}>
            {g.items.map((s) => (
              <button
                key={s.startTime}
                type="button"
                className="time-slot"
                aria-pressed={value?.startTime === s.startTime}
                onClick={() => onChange(s)}
              >
                {s.time}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function QuickScheduler({ doctors }: { doctors: Doctor[] }) {
  const navigate = useNavigate();
  const [doctorId, setDoctorId] = useState(doctors[0]?.id ?? '');
  const doctor = doctors.find((d) => d.id === doctorId) ?? null;

  // Ngày sớm nhất chọn được là hôm nay (giờ Việt Nam); ngày chọn sẵn ban đầu theo defaultBookingDate.
  const today = useMemo(() => fromYmd(todayVn()), []);
  const lastDay = useMemo(() => fromYmd(addDays(toYmd(today), MAX_DAYS_AHEAD)), [today]);
  const workDays = useMemo(() => new Set(doctor?.schedules.map((s) => s.dayOfWeek) ?? []), [doctor]);
  const isOpen = (d: Date) => d >= today && d <= lastDay && workDays.has(d.getDay());

  /** Ngày làm việc gần nhất của bác sĩ, tính từ `from`. */
  const firstOpenDay = (from: Date): Date | undefined => {
    for (let i = 0; i <= MAX_DAYS_AHEAD; i++) {
      const d = fromYmd(addDays(toYmd(from), i));
      if (isOpen(d)) return d;
    }
    return undefined;
  };

  const [date, setDate] = useState<Date | undefined>(() => firstOpenDay(fromYmd(defaultBookingDate())));
  const [slot, setSlot] = useState<Slot | null>(null);

  // Đổi bác sĩ: bỏ giờ đã chọn, chuyển sang ngày bác sĩ đó có làm việc.
  useEffect(() => {
    setSlot(null);
    setDate((d) => (d && isOpen(d) ? d : firstOpenDay(fromYmd(defaultBookingDate()))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctorId]);

  const ymd = date ? toYmd(date) : null;

  const reset = () => {
    setDate(undefined);
    setSlot(null);
  };

  const confirm = () => {
    if (!doctor || !ymd || !slot) return;
    navigate(`/dat-lich?${new URLSearchParams({ doctorId: doctor.id, date: ymd, startTime: slot.startTime }).toString()}`);
  };

  return (
    <div className="scheduler">
      <div className="scheduler-head">
        <div className="stack" style={{ gap: 'var(--space-1)' }}>
          <h2>Đặt lịch nhanh</h2>
          <p className="muted">Xem giờ trống không cần đăng nhập.</p>
        </div>
        <label className="field scheduler-doctor">
          <span className="field-label">Bác sĩ</span>
          <select className="select" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.specialty.name} – BS. {d.fullName}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="scheduler-body">
        <section className="scheduler-panel" aria-label="Chọn ngày khám">
          <Calendar
            mode="single"
            selected={date}
            onSelect={(d) => {
              setDate(d);
              setSlot(null);
            }}
            defaultMonth={date ?? today}
            startMonth={today}
            endMonth={lastDay}
            disabled={(d) => !isOpen(d)}
          />
        </section>
        <section className="scheduler-panel scheduler-times" aria-label="Chọn giờ khám">
          <p className="scheduler-panel-title">{ymd ? `Chọn giờ · ${longDate(ymd)}` : 'Chọn giờ'}</p>
          {doctor && ymd ? (
            <TimeSlots doctorId={doctor.id} date={ymd} value={slot} onChange={setSlot} />
          ) : (
            <p className="scheduler-empty">Chọn một ngày trên lịch để xem giờ còn trống.</p>
          )}
        </section>
      </div>

      <div className="scheduler-foot">
        <p className="small muted" aria-live="polite">
          {slot && doctor ? `Bạn chọn: BS. ${doctor.fullName} · ${formatDateTime(slot.startTime)}` : 'Chọn ngày và giờ để tiếp tục.'}
        </p>
        <div className="row">
          <button type="button" className="btn btn-sm" onClick={reset}>
            Đặt lại
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={!slot} onClick={confirm}>
            Tiếp tục
          </button>
        </div>
      </div>
    </div>
  );
}
