import { useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { addDays, dayOfWeek, shortDate, todayVn, vnTime, weekdayShort } from '../lib/time';
import type { Slot } from '../lib/types';
import { ErrorAlert, Spinner } from './common';

const DAYS_AHEAD = 14;

/** Các ngày có thể đặt (từ hôm nay đến 14 ngày tới). */
export function upcomingDates(): string[] {
  const today = todayVn();
  return Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(today, i));
}

/** Ngày mặc định: hôm nay nếu còn sớm, nếu không thì ngày làm việc kế tiếp (bỏ Chủ nhật). */
export function defaultBookingDate(): string {
  const today = todayVn();
  const lateToday = vnTime(new Date()) >= '16:00';
  return upcomingDates().find((d) => dayOfWeek(d) !== 0 && !(d === today && lateToday)) ?? today;
}

export function DateChips({ value, onChange, label = 'Ngày khám' }: { value: string; onChange: (date: string) => void; label?: string }) {
  const today = todayVn();
  return (
    <fieldset className="field fieldset">
      <legend className="field-label">{label}</legend>
      <div className="chip-row" role="group" aria-label={label}>
        {upcomingDates().map((d) => (
          <button key={d} type="button" className="chip" aria-pressed={d === value} onClick={() => onChange(d)}>
            {d === today ? 'Hôm nay' : `${weekdayShort(d)} ${shortDate(d)}`}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** Khung giờ còn trống của bác sĩ trong ngày, chia buổi sáng và buổi chiều. */
export function SlotGrid({
  doctorId,
  date,
  value,
  onChange,
  reloadKey = 0,
}: {
  doctorId: string;
  date: string;
  value: string | null;
  onChange: (slot: Slot | null) => void;
  reloadKey?: number;
}) {
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setSlots(null);
    setError(null);
    api
      .get<{ slots: Slot[] }>(`/doctors/${doctorId}/slots`, { date }, ctrl.signal)
      .then((res) => setSlots(res.slots))
      .catch((err: unknown) => {
        if (!ctrl.signal.aborted) setError(errorMessage(err));
      });
    return () => ctrl.abort();
  }, [doctorId, date, reloadKey]);

  // Bỏ chọn nếu khung đã chọn không còn trong danh sách mới.
  useEffect(() => {
    if (slots && value && !slots.some((s) => s.startTime === value)) onChange(null);
  }, [slots, value, onChange]);

  const groups = useMemo(() => {
    const list = slots ?? [];
    return [
      { label: 'Buổi sáng', items: list.filter((s) => s.time < '12:00') },
      { label: 'Buổi chiều', items: list.filter((s) => s.time >= '12:00') },
    ].filter((g) => g.items.length > 0);
  }, [slots]);

  if (error) return <ErrorAlert message={error} />;
  if (!slots) return <Spinner label="Đang tải giờ trống" />;
  if (slots.length === 0) return <p className="alert alert-info">Ngày này không còn giờ trống. Bạn chọn ngày khác nhé.</p>;

  return (
    <div className="stack">
      {groups.map((g) => (
        <div key={g.label} className="field">
          <span className="field-hint">{g.label}</span>
          <div className="slot-grid" role="group" aria-label={`Giờ trống ${g.label.toLowerCase()}`}>
            {g.items.map((s) => (
              <button key={s.startTime} type="button" className="slot" aria-pressed={s.startTime === value} onClick={() => onChange(s)}>
                {s.time}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
