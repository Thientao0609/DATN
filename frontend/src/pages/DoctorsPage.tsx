import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Empty, ErrorAlert, Spinner, initials } from '../components/common';
import { api } from '../lib/api';
import { formatMoney } from '../lib/time';
import type { Doctor, Specialty, WorkingSchedule } from '../lib/types';
import { useAsync } from '../lib/useAsync';

const DAY_SHORT = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

/** "T2–T7 · 08:00–11:30, 13:30–17:00" */
function scheduleSummary(schedules: WorkingSchedule[]): string {
  if (schedules.length === 0) return 'Chưa có lịch làm việc';
  const days = [...new Set(schedules.map((s) => s.dayOfWeek))].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  const ranges = [...new Set(schedules.map((s) => `${s.startTime}–${s.endTime}`))].sort();
  const consecutive = days.every((d, i) => i === 0 || (d + 6) % 7 === ((days[i - 1]! + 6) % 7) + 1);
  const dayText = consecutive && days.length > 2 ? `${DAY_SHORT[days[0]!]}–${DAY_SHORT[days.at(-1)!]}` : days.map((d) => DAY_SHORT[d]).join(', ');
  return `${dayText} · ${ranges.join(', ')}`;
}

export function DoctorsPage() {
  const [params, setParams] = useSearchParams();
  const specialtyId = params.get('specialtyId') ?? '';
  const [q, setQ] = useState(params.get('q') ?? '');

  const specialties = useAsync((signal) => api.get<{ specialties: Specialty[] }>('/specialties', undefined, signal), []);
  const doctors = useAsync(
    (signal) => api.get<{ doctors: Doctor[] }>('/doctors', { specialtyId, q: params.get('q') ?? '' }, signal),
    [specialtyId, params.get('q')],
  );

  const setFilter = (next: { specialtyId?: string; q?: string }) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    setParams(p, { replace: true });
  };

  return (
    <div className="container page">
      <div className="page-header">
        <h1>Bác sĩ</h1>
        <p className="muted">Tìm bác sĩ theo chuyên khoa hoặc tên.</p>
      </div>

      <form
        className="row"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter({ q: q.trim() });
        }}
      >
        <label className="sr-only" htmlFor="doctor-search">
          Tìm theo tên bác sĩ
        </label>
        <input id="doctor-search" className="input" style={{ flex: 1, minWidth: 'var(--card-min)' }} placeholder="Tìm theo tên bác sĩ" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="submit" className="btn btn-outline">
          Tìm
        </button>
      </form>

      {specialties.data && (
        <div className="chip-row" role="group" aria-label="Lọc theo chuyên khoa">
          <button type="button" className="chip" aria-pressed={!specialtyId} onClick={() => setFilter({ specialtyId: '' })}>
            Tất cả
          </button>
          {specialties.data.specialties.map((s) => (
            <button key={s.id} type="button" className="chip" aria-pressed={specialtyId === s.id} onClick={() => setFilter({ specialtyId: s.id })}>
              {s.name}
            </button>
          ))}
        </div>
      )}

      {doctors.loading && !doctors.data && <Spinner />}
      <ErrorAlert message={doctors.error ?? specialties.error} />
      {doctors.data && doctors.data.doctors.length === 0 && <Empty>Không tìm thấy bác sĩ phù hợp.</Empty>}

      <div className="grid">
        {doctors.data?.doctors.map((d) => (
          <article key={d.id} className="card stack">
            <div className="row" style={{ gap: 'var(--space-2)' }}>
              <span className="avatar" aria-hidden="true">
                {initials(d.fullName)}
              </span>
              <div>
                <h3>BS. {d.fullName}</h3>
                <p className="small muted">{d.specialty.name}</p>
              </div>
            </div>
            <p className="small">{d.bio}</p>
            <dl className="summary small">
              <dt>Phí khám</dt>
              <dd>{formatMoney(d.fee)}</dd>
              <dt>Lịch làm việc</dt>
              <dd>{scheduleSummary(d.schedules)}</dd>
            </dl>
            <Link to={`/dat-lich?doctorId=${d.id}`} className="btn btn-outline btn-sm">
              Xem giờ trống & đặt lịch
            </Link>
          </article>
        ))}
      </div>
    </div>
  );
}
