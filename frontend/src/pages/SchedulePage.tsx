import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Empty, ErrorAlert, Modal, Spinner, StatusBadge } from '../components/common';
import { Icon } from '../components/Icon';
import { useAuth } from '../context/AuthContext';
import { api, errorMessage } from '../lib/api';
import {
  addDays,
  dayOfWeek,
  daysInMonth,
  formatDateTime,
  longDate,
  minutesOf,
  shortDate,
  startOfWeek,
  timeOf,
  todayVn,
  vnDate,
  vnDateTime,
  vnTime,
  weekdayShort,
} from '../lib/time';
import type { AdminAppointment, Appointment, AppointmentStatus, CreatedVia, Doctor } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { usePageTitle } from '../lib/usePageTitle';

type View = 'day' | 'week' | 'month' | 'list';
const VIEWS: { id: View; label: string }[] = [
  { id: 'day', label: 'Ngày' },
  { id: 'week', label: 'Tuần' },
  { id: 'month', label: 'Tháng' },
  { id: 'list', label: 'Danh sách' },
];

/** Lịch hẹn hiển thị trên lịch; `reason` chỉ có khi bác sĩ xem lịch của chính mình. */
interface CalAppt {
  id: string;
  startTime: string;
  date: string;
  time: string;
  status: AppointmentStatus;
  createdVia: CreatedVia;
  doctorId: string;
  doctorName: string;
  specialtyName: string;
  patientName: string;
  patientPhone: string | null;
  reason?: string;
  /** Khác null khi đây là khung đang giữ chỗ cho một yêu cầu đổi lịch. */
  rescheduleOfId: string | null;
  changeReason: string | null;
}

function fromAdmin(a: AdminAppointment): CalAppt {
  return {
    id: a.id,
    startTime: a.startTime,
    date: vnDate(a.startTime),
    time: vnTime(a.startTime),
    status: a.status,
    createdVia: a.createdVia,
    doctorId: a.doctor.id,
    doctorName: a.doctor.fullName,
    specialtyName: a.doctor.specialty.name,
    patientName: a.patient.fullName,
    patientPhone: a.patient.phone,
    rescheduleOfId: a.rescheduleOfId,
    changeReason: a.rescheduleOfId ? a.changeReason : null,
  };
}

function fromDoctor(a: Appointment): CalAppt {
  return { ...fromAdmin(a), reason: a.reason };
}

/** Các giờ bắt đầu khung khám của bác sĩ trong một ngày. */
function gridTimes(doctor: Doctor, date: string): string[] {
  const dow = dayOfWeek(date);
  const times = new Set<string>();
  for (const s of doctor.schedules.filter((x) => x.dayOfWeek === dow)) {
    for (let m = minutesOf(s.startTime); m + doctor.slotMinutes <= minutesOf(s.endTime); m += doctor.slotMinutes) times.add(timeOf(m));
  }
  return [...times].sort();
}

function rangeFor(view: View, anchor: string): { from: string; to: string } {
  if (view === 'week') {
    const from = startOfWeek(anchor);
    return { from, to: addDays(from, 6) };
  }
  if (view === 'month') {
    const [y, m] = anchor.split('-').map(Number);
    const from = `${anchor.slice(0, 7)}-01`;
    return { from, to: `${anchor.slice(0, 7)}-${String(daysInMonth(y!, m!)).padStart(2, '0')}` };
  }
  return { from: anchor, to: anchor };
}

function stepAnchor(view: View, anchor: string, dir: 1 | -1): string {
  if (view === 'week') return addDays(anchor, 7 * dir);
  if (view === 'month') {
    const [y, m] = anchor.split('-').map(Number);
    const d = new Date(Date.UTC(y!, m! - 1 + dir, 1));
    return d.toISOString().slice(0, 10);
  }
  return addDays(anchor, dir);
}

function titleFor(view: View, anchor: string): string {
  const { from, to } = rangeFor(view, anchor);
  if (view === 'week') return `${shortDate(from)} – ${shortDate(addDays(to, -1))}/${to.slice(0, 4)}`;
  if (view === 'month') return `Tháng ${Number(anchor.slice(5, 7))}/${anchor.slice(0, 4)}`;
  return longDate(anchor);
}

const isActive = (a: CalAppt) => a.status !== 'CANCELLED';

// ---------------------------------------------------------------------------
// Ô lịch
// ---------------------------------------------------------------------------

function Cell({ doctor, date, time, appt, onOpen }: { doctor: Doctor; date: string; time: string; appt?: CalAppt; onOpen: (a: CalAppt) => void }) {
  const inGrid = gridTimes(doctor, date).includes(time);
  if (appt) {
    return (
      <button type="button" className={`cal-appt cal-appt-${appt.status.toLowerCase()}`} onClick={() => onOpen(appt)} aria-label={`${time}, ${appt.patientName}`}>
        <span className="cal-appt-name">{appt.patientName}</span>
        <StatusBadge status={appt.status} />
      </button>
    );
  }
  if (!inGrid) return <span className="cal-off" aria-label="Không làm việc" />;
  if (vnDateTime(date, time).getTime() <= Date.now()) return <span className="cal-past">—</span>;
  return <span className="cal-free">Trống</span>;
}

/** Bảng giờ × cột (bác sĩ hoặc ngày). */
function TimeTable({
  columns,
  appts,
  onOpen,
}: {
  columns: { key: string; label: string; sub: string; doctor: Doctor; date: string }[];
  appts: CalAppt[];
  onOpen: (a: CalAppt) => void;
}) {
  const times = useMemo(() => [...new Set(columns.flatMap((c) => gridTimes(c.doctor, c.date)))].sort(), [columns]);
  const index = useMemo(() => {
    const map = new Map<string, CalAppt>();
    for (const a of appts) if (isActive(a)) map.set(`${a.doctorId}|${a.date}|${a.time}`, a);
    return map;
  }, [appts]);

  if (columns.length === 0) return <Empty>Không có bác sĩ phù hợp.</Empty>;
  if (times.length === 0) return <Empty>Không có lịch làm việc trong khoảng này.</Empty>;

  let lastHalf: string | null = null;
  return (
    <div className="table-wrap">
      <table className="cal-table">
        <thead>
          <tr>
            <th scope="col" className="cal-time">
              Giờ
            </th>
            {columns.map((c) => (
              <th key={c.key} scope="col" title={`${c.label} · ${c.sub}`}>
                <span className="cal-col-title">{c.label}</span>
                <span className="caption">{c.sub}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {times.flatMap((t) => {
            const half = t < '12:00' ? 'am' : 'pm';
            const rows = [];
            if (lastHalf === 'am' && half === 'pm') {
              rows.push(
                <tr key={`break-${t}`}>
                  <td colSpan={columns.length + 1} className="cal-break">
                    Nghỉ trưa
                  </td>
                </tr>,
              );
            }
            lastHalf = half;
            rows.push(
              <tr key={t}>
                <th scope="row" className="cal-time">
                  {t}
                </th>
                {columns.map((c) => (
                  <td key={c.key}>
                    <Cell doctor={c.doctor} date={c.date} time={t} appt={index.get(`${c.doctor.id}|${c.date}|${t}`)} onOpen={onOpen} />
                  </td>
                ))}
              </tr>,
            );
            return rows;
          })}
        </tbody>
      </table>
    </div>
  );
}

function countFor(doctor: Doctor, date: string, appts: CalAppt[]) {
  const grid = gridTimes(doctor, date);
  const active = appts.filter((a) => isActive(a) && a.doctorId === doctor.id && a.date === date);
  const bookedTimes = new Set(active.map((a) => a.time));
  const free = grid.filter((t) => !bookedTimes.has(t) && vnDateTime(date, t).getTime() > Date.now()).length;
  return { total: grid.length, booked: active.length, free };
}

// ---------------------------------------------------------------------------
// Các chế độ xem
// ---------------------------------------------------------------------------

function DayView({ date, doctors, appts, onOpen }: { date: string; doctors: Doctor[]; appts: CalAppt[]; onOpen: (a: CalAppt) => void }) {
  const totals = doctors.reduce(
    (acc, d) => {
      const c = countFor(d, date, appts);
      return { total: acc.total + c.total, booked: acc.booked + c.booked, free: acc.free + c.free };
    },
    { total: 0, booked: 0, free: 0 },
  );
  const dayAppts = appts.filter((a) => a.date === date && doctors.some((d) => d.id === a.doctorId));
  const completed = dayAppts.filter((a) => a.status === 'COMPLETED').length;
  const cancelled = dayAppts.filter((a) => a.status === 'CANCELLED').length;
  const columns = doctors.map((d) => ({ key: d.id, label: `BS. ${d.fullName}`, sub: d.specialty.name, doctor: d, date }));
  return (
    <>
      <div className="stat-tiles">
        <div className="stat-tile">
          <span className="caption">Đã đặt</span>
          <strong>
            {totals.booked} / {totals.total} lượt
          </strong>
        </div>
        <div className="stat-tile">
          <span className="caption">Giờ còn trống</span>
          <strong>{totals.free} lượt</strong>
        </div>
        <div className="stat-tile">
          <span className="caption">Đã khám</span>
          <strong>{completed}</strong>
        </div>
        <div className="stat-tile">
          <span className="caption">Đã hủy</span>
          <strong>{cancelled}</strong>
        </div>
      </div>
      <TimeTable columns={columns} appts={appts} onOpen={onOpen} />
    </>
  );
}

function WeekView({ anchor, doctor, appts, onOpen }: { anchor: string; doctor: Doctor; appts: CalAppt[]; onOpen: (a: CalAppt) => void }) {
  const monday = startOfWeek(anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i)).filter((d) => dayOfWeek(d) !== 0 || gridTimes(doctor, d).length > 0);
  const columns = days.map((d) => {
    const c = countFor(doctor, d, appts);
    return { key: d, label: `${weekdayShort(d)} ${shortDate(d)}`, sub: `${c.booked} đặt · ${c.free} trống`, doctor, date: d };
  });
  return <TimeTable columns={columns} appts={appts} onOpen={onOpen} />;
}

function MonthView({ anchor, doctors, appts, onPick }: { anchor: string; doctors: Doctor[]; appts: CalAppt[]; onPick: (date: string) => void }) {
  const { from, to } = rangeFor('month', anchor);
  const today = todayVn();
  const lead = (dayOfWeek(from) + 6) % 7;
  const days: (string | null)[] = [...Array<null>(lead).fill(null)];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return (
    <div className="month-grid" role="grid" aria-label={titleFor('month', anchor)}>
      {['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'CN'].map((w) => (
        <div key={w} className="month-head" role="columnheader">
          {w}
        </div>
      ))}
      {days.map((d, i) => {
        if (!d) return <div key={`empty-${i}`} className="month-cell month-empty" />;
        const counts = doctors.reduce(
          (acc, doc) => {
            const c = countFor(doc, d, appts);
            return { total: acc.total + c.total, booked: acc.booked + c.booked };
          },
          { total: 0, booked: 0 },
        );
        const past = d < today;
        if (counts.total === 0 && counts.booked === 0) {
          return (
            <div key={d} className="month-cell month-closed">
              <span className="month-num">{Number(d.slice(8))}</span>
              <span className="caption">Không khám</span>
            </div>
          );
        }
        return (
          <button key={d} type="button" className={`month-cell${d === today ? ' month-today' : ''}`} onClick={() => onPick(d)} aria-label={`${longDate(d)}: ${counts.booked} lượt đã đặt`}>
            <span className="month-num">{Number(d.slice(8))}</span>
            <span className="caption">{past ? `${counts.booked} lượt` : `${counts.booked}/${counts.total} đã đặt`}</span>
            {!past && counts.total > 0 && (
              <span className="month-bar" aria-hidden="true">
                <span style={{ width: `${Math.min(100, (counts.booked / counts.total) * 100)}%` }} />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function ListView({ appts, showDoctor, onOpen, onComplete }: { appts: CalAppt[]; showDoctor: boolean; onOpen: (a: CalAppt) => void; onComplete?: (a: CalAppt) => void }) {
  if (appts.length === 0) return <Empty>Không có lịch hẹn trong ngày này.</Empty>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Giờ</th>
            <th>Bệnh nhân</th>
            {showDoctor && <th>Bác sĩ</th>}
            <th>Đặt qua</th>
            <th>Trạng thái</th>
            <th>Thao tác</th>
          </tr>
        </thead>
        <tbody>
          {appts.map((a) => (
            <tr key={a.id}>
              <td>
                <strong>{a.time}</strong>
              </td>
              <td>
                {a.patientName}
                {a.patientPhone && <div className="caption">{a.patientPhone}</div>}
              </td>
              {showDoctor && (
                <td>
                  BS. {a.doctorName}
                  <div className="caption">{a.specialtyName}</div>
                </td>
              )}
              <td>{a.createdVia === 'CHATBOT' ? 'Trợ lý AI' : 'Form'}</td>
              <td>
                <StatusBadge status={a.status} />
              </td>
              <td>
                <div className="row">
                  {onComplete && a.status === 'CONFIRMED' && (
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => onComplete(a)}>
                      Đã khám
                    </button>
                  )}
                  <button type="button" className="btn btn-sm" onClick={() => onOpen(a)}>
                    Chi tiết
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DetailDialog({ appt, isDoctor, onClose, onComplete }: { appt: CalAppt; isDoctor: boolean; onClose: () => void; onComplete: (a: CalAppt) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const complete = async () => {
    setBusy(true);
    setError(null);
    try {
      await onComplete(appt);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Chi tiết lịch hẹn" onClose={onClose}>
      <dl className="summary">
        <dt>Thời gian</dt>
        <dd>{formatDateTime(appt.startTime)}</dd>
        <dt>Bệnh nhân</dt>
        <dd>
          {appt.patientName}
          {appt.patientPhone ? ` · ${appt.patientPhone}` : ''}
        </dd>
        <dt>Bác sĩ</dt>
        <dd>
          BS. {appt.doctorName} · {appt.specialtyName}
        </dd>
        <dt>Trạng thái</dt>
        <dd>
          <StatusBadge status={appt.status} />
        </dd>
        <dt>Đặt qua</dt>
        <dd>{appt.createdVia === 'CHATBOT' ? 'Trợ lý AI' : 'Form đặt lịch'}</dd>
        {appt.rescheduleOfId && appt.changeReason && (
          <>
            <dt>Lý do đổi lịch</dt>
            <dd>{appt.changeReason}</dd>
          </>
        )}
        {appt.reason !== undefined && (
          <>
            <dt>Lý do khám</dt>
            <dd>{appt.reason}</dd>
          </>
        )}
      </dl>
      {appt.rescheduleOfId && (
        <p className="alert alert-info">
          Khung giờ này đang được giữ cho một yêu cầu đổi lịch, chờ admin duyệt.
          {!isDoctor && (
            <>
              {' '}
              <Link to="/quan-tri?tab=requests">Xử lý ở mục Yêu cầu đổi lịch ›</Link>
            </>
          )}
        </p>
      )}
      {!isDoctor && <p className="caption">Lý do khám là dữ liệu sức khỏe nên chỉ bệnh nhân và bác sĩ khám xem được.</p>}
      <ErrorAlert message={error} />
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose}>
          Đóng
        </button>
        {isDoctor && appt.status === 'CONFIRMED' && (
          <button type="button" className="btn btn-primary" disabled={busy} onClick={complete}>
            {busy ? 'Đang lưu…' : 'Đánh dấu đã khám'}
          </button>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Trang
// ---------------------------------------------------------------------------

export function SchedulePage() {
  usePageTitle('Lịch khám');
  const { user } = useAuth();
  const isDoctor = user?.role === 'DOCTOR';
  const [view, setView] = useState<View>('day');
  const [anchor, setAnchor] = useState(todayVn());
  const [specialtyId, setSpecialtyId] = useState('');
  const [weekDoctorId, setWeekDoctorId] = useState('');
  const [selected, setSelected] = useState<CalAppt | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const range = rangeFor(view, anchor);

  const doctorsState = useAsync(
    async (signal) => {
      if (isDoctor) {
        if (!user?.doctorId) return [];
        const res = await api.get<{ doctor: Doctor }>(`/doctors/${user.doctorId}`, undefined, signal);
        return [res.doctor];
      }
      return (await api.get<{ doctors: Doctor[] }>('/doctors', undefined, signal)).doctors;
    },
    [isDoctor, user?.doctorId],
  );

  const apptState = useAsync(
    async (signal) => {
      if (isDoctor) {
        const res = await api.get<{ appointments: Appointment[] }>('/appointments/me', undefined, signal);
        return res.appointments.map(fromDoctor).filter((a) => a.date >= range.from && a.date <= range.to);
      }
      const res = await api.get<{ appointments: AdminAppointment[] }>('/admin/appointments', range, signal);
      return res.appointments.map(fromAdmin);
    },
    [isDoctor, range.from, range.to],
  );

  const allDoctors = doctorsState.data ?? [];
  const specialties = useMemo(() => [...new Map(allDoctors.map((d) => [d.specialty.id, d.specialty])).values()], [allDoctors]);
  const doctors = allDoctors.filter((d) => !specialtyId || d.specialty.id === specialtyId);
  const weekDoctor = allDoctors.find((d) => d.id === weekDoctorId) ?? doctors[0] ?? null;
  const appts = useMemo(() => (apptState.data ?? []).slice().sort((a, b) => a.startTime.localeCompare(b.startTime)), [apptState.data]);
  const listAppts = appts.filter((a) => a.date === anchor && doctors.some((d) => d.id === a.doctorId));

  const complete = useCallback(
    async (a: CalAppt) => {
      await api.patch(`/appointments/${a.id}/complete`);
      apptState.reload();
    },
    [apptState],
  );

  const completeFromList = async (a: CalAppt) => {
    setActionError(null);
    try {
      await complete(a);
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };

  const doctorName = isDoctor && allDoctors[0] ? `BS. ${allDoctors[0].fullName} · ${allDoctors[0].specialty.name}` : null;

  return (
    <div className="container page">
      <div className="page-header">
        <h1>Lịch khám</h1>
        <p className="muted">{doctorName ?? 'Lịch đã đặt và giờ còn trống của các bác sĩ'}</p>
      </div>

      <div className="row-between">
        <div className="segmented" role="tablist" aria-label="Chế độ xem">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" role="tab" aria-selected={view === v.id} onClick={() => setView(v.id)}>
              {v.label}
            </button>
          ))}
        </div>
        <div className="row">
          <button type="button" className="icon-btn" aria-label="Trước" onClick={() => setAnchor((a) => stepAnchor(view, a, -1))}>
            <Icon name="left" />
          </button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setAnchor(todayVn())}>
            Hôm nay
          </button>
          <button type="button" className="icon-btn" aria-label="Sau" onClick={() => setAnchor((a) => stepAnchor(view, a, 1))}>
            <Icon name="right" />
          </button>
          <h2 className="cal-title">{titleFor(view, anchor)}</h2>
        </div>
      </div>

      {!isDoctor && (
        <div className="row">
          {view === 'week' ? (
            <label className="field cal-filter">
              <span className="field-label">Bác sĩ</span>
              <select className="select" value={weekDoctor?.id ?? ''} onChange={(e) => setWeekDoctorId(e.target.value)}>
                {allDoctors.map((d) => (
                  <option key={d.id} value={d.id}>
                    BS. {d.fullName} · {d.specialty.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="field cal-filter">
              <span className="field-label">Chuyên khoa</span>
              <select className="select" value={specialtyId} onChange={(e) => setSpecialtyId(e.target.value)}>
                <option value="">Tất cả chuyên khoa</option>
                {specialties.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      <ErrorAlert message={doctorsState.error ?? apptState.error ?? actionError} />
      {(doctorsState.loading || apptState.loading) && !apptState.data && <Spinner />}

      {doctorsState.data && apptState.data && (
        <>
          {view === 'day' && <DayView date={anchor} doctors={doctors} appts={appts} onOpen={setSelected} />}
          {view === 'week' && weekDoctor && <WeekView anchor={anchor} doctor={weekDoctor} appts={appts} onOpen={setSelected} />}
          {view === 'month' && (
            <MonthView
              anchor={anchor}
              doctors={doctors}
              appts={appts}
              onPick={(d) => {
                setAnchor(d);
                setView('day');
              }}
            />
          )}
          {view === 'list' && <ListView appts={listAppts} showDoctor={!isDoctor} onOpen={setSelected} onComplete={isDoctor ? completeFromList : undefined} />}
        </>
      )}

      {selected && <DetailDialog appt={selected} isDoctor={isDoctor} onClose={() => setSelected(null)} onComplete={complete} />}
    </div>
  );
}
