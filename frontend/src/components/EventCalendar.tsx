/**
 * Lịch khám của phòng khám (chỉ xem) trên trang Đặt lịch.
 * Bố cục theo component "EventManager": xem theo tháng / tuần / ngày / danh sách, tìm kiếm, bộ lọc,
 * thẻ sự kiện có ô thông tin khi rê chuột và hộp thoại chi tiết. Chuyển sang hệ kiểu dáng của dự án;
 * dữ liệu chỉ có bác sĩ, chuyên khoa và giờ — không có thông tin bệnh nhân. Không tạo/sửa/xóa/kéo thả
 * vì đây là trang dành cho bệnh nhân.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { normalizeVi } from '../lib/text';
import {
  addDays,
  dayOfWeek,
  longDate,
  minutesOf,
  shortDate,
  startOfWeek,
  todayVn,
  vnDate,
  vnTime,
  weekdayShort,
} from '../lib/time';
import type { CalendarEvent, Doctor, Specialty } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { Icon, type IconName } from './Icon';
import { ErrorAlert, Modal, Spinner } from './common';

type View = 'month' | 'week' | 'day' | 'list';
const VIEWS: { id: View; label: string; icon: IconName }[] = [
  { id: 'month', label: 'Tháng', icon: 'calendar' },
  { id: 'week', label: 'Tuần', icon: 'grid' },
  { id: 'day', label: 'Ngày', icon: 'clock' },
  { id: 'list', label: 'Danh sách', icon: 'list' },
];
const WEEK_HEAD = ['Th 2', 'Th 3', 'Th 4', 'Th 5', 'Th 6', 'Th 7', 'CN'];
const LIST_DAYS = 30;

const STATE_LABEL: Record<CalendarEvent['state'], string> = {
  BOOKED: 'Đã có người đặt',
  HELD: 'Đang giữ chỗ cho yêu cầu đổi lịch',
  COMPLETED: 'Đã khám',
};

const eventKey = (e: CalendarEvent) => `${e.doctor.id}|${e.startTime}`;
const durationText = (e: CalendarEvent) => {
  const minutes = Math.round((new Date(e.endTime).getTime() - new Date(e.startTime).getTime()) / 60000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} giờ${minutes % 60 ? ` ${minutes % 60} phút` : ''}` : `${minutes} phút`;
};
const timeRange = (e: CalendarEvent) => `${vnTime(e.startTime)} – ${vnTime(e.endTime)}`;

function rangeFor(view: View, anchor: string): { from: string; to: string } {
  if (view === 'month') {
    const from = startOfWeek(`${anchor.slice(0, 7)}-01`);
    return { from, to: addDays(from, 41) };
  }
  if (view === 'week') {
    const from = startOfWeek(anchor);
    return { from, to: addDays(from, 6) };
  }
  if (view === 'list') {
    const from = todayVn();
    return { from, to: addDays(from, LIST_DAYS) };
  }
  return { from: anchor, to: anchor };
}

function step(view: View, anchor: string, dir: 1 | -1): string {
  if (view === 'month') {
    const [y, m] = anchor.split('-').map(Number);
    return new Date(Date.UTC(y!, m! - 1 + dir, 1)).toISOString().slice(0, 10);
  }
  return addDays(anchor, view === 'week' ? 7 * dir : dir);
}

function titleFor(view: View, anchor: string): string {
  if (view === 'month') return `Tháng ${Number(anchor.slice(5, 7))}/${anchor.slice(0, 4)}`;
  if (view === 'week') {
    const from = startOfWeek(anchor);
    const to = addDays(from, 6);
    return `Tuần ${shortDate(from)} – ${shortDate(to)}/${to.slice(0, 4)}`;
  }
  if (view === 'day') return longDate(anchor);
  return `Lịch khám ${LIST_DAYS} ngày tới`;
}

// ---------------------------------------------------------------------------
// Thẻ sự kiện
// ---------------------------------------------------------------------------

function EventPopover({ event }: { event: CalendarEvent }) {
  return (
    <span className="ev-pop" role="tooltip">
      <strong>BS. {event.doctor.fullName}</strong>
      <span className="caption">{event.specialty.name}</span>
      <span className="ev-pop-row">
        <Icon name="clock" size={12} /> {timeRange(event)} ({durationText(event)})
      </span>
      <span className={`ev-state ev-state-${event.state.toLowerCase()}`}>{STATE_LABEL[event.state]}</span>
    </span>
  );
}

function EventChip({ event, variant, onOpen }: { event: CalendarEvent; variant: 'compact' | 'default' | 'detailed'; onOpen: (e: CalendarEvent) => void }) {
  const cls = `ev ev-${variant} ev-${event.state.toLowerCase()}`;
  if (variant === 'detailed') {
    return (
      <button type="button" className={cls} onClick={() => onOpen(event)}>
        <span className="ev-title">BS. {event.doctor.fullName}</span>
        <span className="ev-sub">{event.specialty.name}</span>
        <span className="ev-sub">
          <Icon name="clock" size={12} /> {timeRange(event)} · {STATE_LABEL[event.state]}
        </span>
      </button>
    );
  }
  return (
    <span className="ev-wrap">
      <button type="button" className={cls} onClick={() => onOpen(event)} aria-label={`${timeRange(event)}, bác sĩ ${event.doctor.fullName}, ${STATE_LABEL[event.state]}`}>
        <span className="ev-time">{vnTime(event.startTime)}</span> BS. {event.doctor.fullName}
      </button>
      <EventPopover event={event} />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Các chế độ xem
// ---------------------------------------------------------------------------

function MonthView({ anchor, events, onOpen, onShowDay }: { anchor: string; events: CalendarEvent[]; onOpen: (e: CalendarEvent) => void; onShowDay: (d: string) => void }) {
  const { from } = rangeFor('month', anchor);
  const month = anchor.slice(0, 7);
  const today = todayVn();
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const d = vnDate(e.startTime);
      map.set(d, [...(map.get(d) ?? []), e]);
    }
    return map;
  }, [events]);
  return (
    <div className="ec-card">
      <div className="ec-month-head">
        {WEEK_HEAD.map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>
      <div className="ec-month-grid">
        {Array.from({ length: 42 }, (_, i) => addDays(from, i)).map((d) => {
          const list = byDay.get(d) ?? [];
          return (
            <div key={d} className={`ec-day${d.slice(0, 7) !== month ? ' ec-day-outside' : ''}`}>
              <span className={`ec-day-num${d === today ? ' ec-day-today' : ''}`}>{Number(d.slice(8))}</span>
              <div className="ec-day-events">
                {list.slice(0, 3).map((e) => (
                  <EventChip key={eventKey(e)} event={e} variant="compact" onOpen={onOpen} />
                ))}
                {list.length > 3 && (
                  <button type="button" className="ec-more" onClick={() => onShowDay(d)}>
                    +{list.length - 3} lịch nữa
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HourGrid({ days, hours, events, onOpen, detailed }: { days: string[]; hours: number[]; events: CalendarEvent[]; onOpen: (e: CalendarEvent) => void; detailed: boolean }) {
  const index = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const key = `${vnDate(e.startTime)}|${Math.floor(minutesOf(vnTime(e.startTime)) / 60)}`;
      map.set(key, [...(map.get(key) ?? []), e]);
    }
    return map;
  }, [events]);
  const today = todayVn();
  return (
    <div className="ec-card ec-scroll">
      <table className="ec-hours">
        <thead>
          <tr>
            <th scope="col" className="ec-hour-col">
              Giờ
            </th>
            {days.map((d) => (
              <th key={d} scope="col" className={d === today ? 'ec-col-today' : undefined}>
                <span>{weekdayShort(d)}</span>
                <span className="caption">{shortDate(d)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {hours.map((h) => (
            <tr key={h}>
              <th scope="row" className="ec-hour-col">
                {String(h).padStart(2, '0')}:00
              </th>
              {days.map((d) => (
                <td key={d}>
                  <div className="ec-cell">
                    {(index.get(`${d}|${h}`) ?? []).map((e) => (
                      <EventChip key={eventKey(e)} event={e} variant={detailed ? 'detailed' : 'default'} onOpen={onOpen} />
                    ))}
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ListView({ events, onOpen }: { events: CalendarEvent[]; onOpen: (e: CalendarEvent) => void }) {
  const groups = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of [...events].sort((a, b) => a.startTime.localeCompare(b.startTime))) {
      const d = vnDate(e.startTime);
      map.set(d, [...(map.get(d) ?? []), e]);
    }
    return [...map.entries()];
  }, [events]);
  if (groups.length === 0) return <div className="ec-card ec-empty">Không có lịch khám nào phù hợp.</div>;
  return (
    <div className="ec-card ec-list">
      {groups.map(([d, list]) => (
        <section key={d} className="stack" aria-label={longDate(d)}>
          <h3 className="ec-list-date">{longDate(d)}</h3>
          {list.map((e) => (
            <button key={eventKey(e)} type="button" className="ec-list-item" onClick={() => onOpen(e)}>
              <span className={`ec-dot ev-${e.state.toLowerCase()}`} aria-hidden="true" />
              <span className="ec-list-main">
                <strong>BS. {e.doctor.fullName}</strong>
                <span className="caption">
                  <Icon name="clock" size={12} /> {timeRange(e)} · {e.specialty.name}
                </span>
              </span>
              <span className={`ev-state ev-state-${e.state.toLowerCase()}`}>{STATE_LABEL[e.state]}</span>
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bộ lọc
// ---------------------------------------------------------------------------

function FilterMenu({ label, options, selected, onChange }: { label: string; options: { id: string; name: string }[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="ec-filter" ref={ref}>
      <button type="button" className="btn btn-outline btn-sm" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((v) => !v)}>
        <Icon name="filter" size={16} /> {label}
        {selected.length > 0 && <span className="ec-count">{selected.length}</span>}
      </button>
      {open && (
        <div className="ec-filter-panel" role="group" aria-label={`Lọc theo ${label.toLowerCase()}`}>
          <span className="ec-filter-title">Lọc theo {label.toLowerCase()}</span>
          {options.map((o) => (
            <label key={o.id} className="ec-check">
              <input
                type="checkbox"
                checked={selected.includes(o.id)}
                onChange={(e) => onChange(e.target.checked ? [...selected, o.id] : selected.filter((id) => id !== o.id))}
              />
              {o.name}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lịch chính
// ---------------------------------------------------------------------------

export function EventCalendar({
  doctors,
  specialties,
  onPickDoctor,
  refreshKey = 0,
}: {
  doctors: Doctor[];
  specialties: Specialty[];
  onPickDoctor?: (doctorId: string) => void;
  refreshKey?: number;
}) {
  // Màn hình hẹp: lưới tuần phải cuộn ngang, nên mở sẵn dạng danh sách.
  const [view, setView] = useState<View>(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches ? 'list' : 'week',
  );
  const [anchor, setAnchor] = useState(todayVn());
  const [query, setQuery] = useState('');
  const [specialtyIds, setSpecialtyIds] = useState<string[]>([]);
  const [doctorIds, setDoctorIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const range = rangeFor(view, anchor);

  const data = useAsync(
    (signal) => api.get<{ events: CalendarEvent[] }>('/appointments/calendar', range, signal),
    [range.from, range.to, refreshKey],
  );

  const events = useMemo(() => {
    const q = normalizeVi(query.trim());
    return (data.data?.events ?? []).filter(
      (e) =>
        (!q || normalizeVi(`${e.doctor.fullName} ${e.specialty.name}`).includes(q)) &&
        (specialtyIds.length === 0 || specialtyIds.includes(e.specialty.id)) &&
        (doctorIds.length === 0 || doctorIds.includes(e.doctor.id)),
    );
  }, [data.data, query, specialtyIds, doctorIds]);

  // Khung giờ hiển thị cho xem theo tuần/ngày: từ giờ mở cửa sớm nhất tới giờ đóng muộn nhất.
  const hours = useMemo(() => {
    const all = doctors.flatMap((d) => d.schedules);
    const start = all.length ? Math.floor(Math.min(...all.map((s) => minutesOf(s.startTime))) / 60) : 8;
    const end = all.length ? Math.ceil(Math.max(...all.map((s) => minutesOf(s.endTime))) / 60) : 17;
    return Array.from({ length: Math.max(1, end - start) }, (_, i) => start + i);
  }, [doctors]);

  const hasFilters = specialtyIds.length > 0 || doctorIds.length > 0 || query.trim() !== '';
  const clearFilters = () => {
    setSpecialtyIds([]);
    setDoctorIds([]);
    setQuery('');
  };
  const nameOf = (list: { id: string; name: string }[], id: string) => list.find((x) => x.id === id)?.name ?? '';
  const doctorOptions = doctors.map((d) => ({ id: d.id, name: `BS. ${d.fullName}` }));
  const specialtyOptions = specialties.map((s) => ({ id: s.id, name: s.name }));
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i)).filter(
    (d) => dayOfWeek(d) !== 0 || doctors.some((doc) => doc.schedules.some((s) => s.dayOfWeek === 0)),
  );

  return (
    <div className="ec">
      <div className="ec-toolbar">
        <div className="ec-nav">
          <h3 className="ec-title">{titleFor(view, anchor)}</h3>
          {view !== 'list' && (
            <div className="row">
              <button type="button" className="icon-btn ec-nav-btn" aria-label="Trước" onClick={() => setAnchor((a) => step(view, a, -1))}>
                <Icon name="left" size={16} />
              </button>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setAnchor(todayVn())}>
                Hôm nay
              </button>
              <button type="button" className="icon-btn ec-nav-btn" aria-label="Sau" onClick={() => setAnchor((a) => step(view, a, 1))}>
                <Icon name="right" size={16} />
              </button>
            </div>
          )}
        </div>
        <label className="sr-only" htmlFor="ec-view-select">
          Chế độ xem
        </label>
        <select id="ec-view-select" className="select ec-view-select" value={view} onChange={(e) => setView(e.target.value as View)}>
          {VIEWS.map((v) => (
            <option key={v.id} value={v.id}>
              Xem theo {v.label.toLowerCase()}
            </option>
          ))}
        </select>
        <div className="segmented ec-view-tabs" role="tablist" aria-label="Chế độ xem">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" role="tab" aria-selected={view === v.id} onClick={() => setView(v.id)}>
              <Icon name={v.icon} size={14} /> {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ec-filters">
        <div className="ec-search">
          <Icon name="search" size={16} />
          <label className="sr-only" htmlFor="ec-search">
            Tìm theo bác sĩ hoặc chuyên khoa
          </label>
          <input id="ec-search" className="input" placeholder="Tìm theo bác sĩ hoặc chuyên khoa…" value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && (
            <button type="button" className="icon-btn ec-search-clear" aria-label="Xóa tìm kiếm" onClick={() => setQuery('')}>
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
        <div className="ec-filter-row">
          <FilterMenu label="Chuyên khoa" options={specialtyOptions} selected={specialtyIds} onChange={setSpecialtyIds} />
          <FilterMenu label="Bác sĩ" options={doctorOptions} selected={doctorIds} onChange={setDoctorIds} />
          {hasFilters && (
            <button type="button" className="btn btn-sm" onClick={clearFilters}>
              <Icon name="close" size={14} /> Xóa lọc
            </button>
          )}
        </div>
      </div>

      {(specialtyIds.length > 0 || doctorIds.length > 0) && (
        <div className="ec-active">
          <span className="caption">Đang lọc:</span>
          {specialtyIds.map((id) => (
            <span key={id} className="ec-tag">
              {nameOf(specialtyOptions, id)}
              <button type="button" aria-label={`Bỏ lọc ${nameOf(specialtyOptions, id)}`} onClick={() => setSpecialtyIds((l) => l.filter((x) => x !== id))}>
                <Icon name="close" size={12} />
              </button>
            </span>
          ))}
          {doctorIds.map((id) => (
            <span key={id} className="ec-tag">
              {nameOf(doctorOptions, id)}
              <button type="button" aria-label={`Bỏ lọc ${nameOf(doctorOptions, id)}`} onClick={() => setDoctorIds((l) => l.filter((x) => x !== id))}>
                <Icon name="close" size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      <ErrorAlert message={data.error} />
      {data.loading && !data.data && <Spinner label="Đang tải lịch khám" />}

      {data.data && view === 'month' && (
        <MonthView
          anchor={anchor}
          events={events}
          onOpen={setSelected}
          onShowDay={(d) => {
            setAnchor(d);
            setView('day');
          }}
        />
      )}
      {data.data && view === 'week' && <HourGrid days={weekDays} hours={hours} events={events} onOpen={setSelected} detailed={false} />}
      {data.data && view === 'day' && <HourGrid days={[anchor]} hours={hours} events={events} onOpen={setSelected} detailed />}
      {data.data && view === 'list' && <ListView events={events} onOpen={setSelected} />}

      <p className="caption">
        Lịch chỉ hiển thị bác sĩ khám và khung giờ đã có người đặt; thông tin bệnh nhân được bảo mật.
        {data.data && ` ${events.length} lịch trong khoảng đang xem.`}
      </p>

      {selected && (
        <Modal title="Chi tiết lịch khám" onClose={() => setSelected(null)}>
          <dl className="summary">
            <dt>Bác sĩ</dt>
            <dd>BS. {selected.doctor.fullName}</dd>
            <dt>Chuyên khoa</dt>
            <dd>{selected.specialty.name}</dd>
            <dt>Ngày</dt>
            <dd>{longDate(vnDate(selected.startTime))}</dd>
            <dt>Giờ</dt>
            <dd>
              {timeRange(selected)} · {durationText(selected)}
            </dd>
            <dt>Trạng thái</dt>
            <dd>
              <span className={`ev-state ev-state-${selected.state.toLowerCase()}`}>{STATE_LABEL[selected.state]}</span>
            </dd>
          </dl>
          <p className="caption">Thông tin bệnh nhân được bảo mật, chỉ hiển thị bác sĩ khám.</p>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={() => setSelected(null)}>
              Đóng
            </button>
            {onPickDoctor && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  onPickDoctor(selected.doctor.id);
                  setSelected(null);
                }}
              >
                Đặt lịch với bác sĩ này
              </button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
