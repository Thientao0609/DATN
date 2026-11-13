import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { DateChips, SlotGrid } from '../components/SlotPicker';
import { Empty, ErrorAlert, Modal, Spinner, StatusBadge } from '../components/common';
import { useApp } from '../context/AppContext';
import { ApiError, api, errorMessage } from '../lib/api';
import { formatDateTime, formatMoney, todayVn, vnDate } from '../lib/time';
import type { Appointment, Slot } from '../lib/types';
import { useAsync } from '../lib/useAsync';

type Tab = 'upcoming' | 'past' | 'cancelled';
const TABS: { id: Tab; label: string }[] = [
  { id: 'upcoming', label: 'Sắp tới' },
  { id: 'past', label: 'Đã khám / đã qua' },
  { id: 'cancelled', label: 'Đã hủy' },
];
const CHANGE_LIMIT_MS = 2 * 60 * 60 * 1000;
const REASON_MIN = 5;
const REASON_MAX = 500;

function canChange(a: Appointment): boolean {
  return a.status === 'CONFIRMED' && new Date(a.startTime).getTime() - Date.now() >= CHANGE_LIMIT_MS;
}

/** Ô nhập lý do đổi/hủy lịch, bắt buộc 5–500 ký tự. */
function ReasonField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  const length = value.trim().length;
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <textarea className="textarea" value={value} maxLength={REASON_MAX} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <span className="field-hint">
        Bắt buộc, từ {REASON_MIN} đến {REASON_MAX} ký tự{length > 0 ? ` · ${length}/${REASON_MAX}` : ''}.
      </span>
    </label>
  );
}

const reasonOk = (v: string) => v.trim().length >= REASON_MIN && v.trim().length <= REASON_MAX;

function RescheduleDialog({ appointment, onClose, onDone }: { appointment: Appointment; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(() => {
    const d = vnDate(appointment.pendingChange?.startTime ?? appointment.startTime);
    return d >= todayVn() ? d : todayVn();
  });
  const [slot, setSlot] = useState<Slot | null>(null);
  const [reason, setReason] = useState(appointment.pendingChange?.reason ?? '');
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onSlot = useCallback((s: Slot | null) => setSlot(s), []);

  const save = async () => {
    if (!slot || !reasonOk(reason)) return;
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/appointments/${appointment.id}/reschedule`, { startTime: slot.startTime, changeReason: reason.trim() });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError && err.code === 'SLOT_TAKEN') {
        setSlot(null);
        setReloadKey((k) => k + 1);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Đổi lịch khám" onClose={onClose}>
      <p className="small muted">
        Bác sĩ {appointment.doctor.fullName} · Lịch hiện tại {formatDateTime(appointment.startTime)}
      </p>
      <p className="alert alert-info">
        Giờ mới cần phòng khám xác nhận. Trong lúc chờ, lịch hiện tại vẫn được giữ; nếu yêu cầu không được chấp nhận, bạn sẽ nhận email thông báo.
      </p>
      <DateChips
        value={date}
        onChange={(d) => {
          setDate(d);
          setSlot(null);
        }}
      />
      <SlotGrid doctorId={appointment.doctor.id} date={date} value={slot?.startTime ?? null} onChange={onSlot} reloadKey={reloadKey} />
      <ReasonField label="Lý do đổi lịch" value={reason} onChange={setReason} placeholder="Ví dụ: Trùng lịch công tác buổi sáng" />
      <ErrorAlert message={error} />
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose}>
          Đóng
        </button>
        <button type="button" className="btn btn-primary" disabled={!slot || !reasonOk(reason) || busy} onClick={save}>
          {busy ? 'Đang gửi…' : slot ? `Gửi yêu cầu đổi sang ${slot.time}` : 'Chọn giờ mới'}
        </button>
      </div>
    </Modal>
  );
}

function CancelDialog({ appointment, onClose, onDone }: { appointment: Appointment; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    if (!reasonOk(reason)) return;
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/appointments/${appointment.id}/cancel`, { cancelReason: reason.trim() });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Hủy lịch khám?" onClose={onClose}>
      <p>
        Lịch với bác sĩ {appointment.doctor.fullName} lúc {formatDateTime(appointment.startTime)} sẽ bị hủy và khung giờ được mở lại cho người khác.
        {appointment.pendingChange && ' Yêu cầu đổi lịch đang chờ cũng sẽ bị hủy.'}
      </p>
      <ReasonField label="Lý do hủy lịch" value={reason} onChange={setReason} placeholder="Ví dụ: Đã khỏi bệnh, không cần khám nữa" />
      <ErrorAlert message={error} />
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose}>
          Giữ lịch
        </button>
        <button type="button" className="btn btn-danger-solid" disabled={busy || !reasonOk(reason)} onClick={confirm}>
          {busy ? 'Đang hủy…' : 'Hủy lịch'}
        </button>
      </div>
    </Modal>
  );
}

/** Thẻ ghi lý do bên dưới lịch hẹn: yêu cầu đổi đang chờ, đổi đã duyệt, bị từ chối, hoặc đã hủy. */
function ReasonCards({ a }: { a: Appointment }) {
  return (
    <>
      {a.pendingChange && (
        <section className="reason-card reason-card-pending" aria-label="Yêu cầu đổi lịch đang chờ xác nhận">
          <span className="reason-card-title">
            Yêu cầu đổi lịch <StatusBadge status="PENDING" />
          </span>
          <dl className="summary">
            <dt>Giờ mới</dt>
            <dd>{formatDateTime(a.pendingChange.startTime)}</dd>
            <dt>Lý do đổi lịch</dt>
            <dd>{a.pendingChange.reason}</dd>
          </dl>
          <span className="caption">Đang chờ phòng khám xác nhận. Trong lúc chờ, lịch hiện tại vẫn được giữ.</span>
        </section>
      )}
      {a.changeRejection && (
        <section className="reason-card reason-card-rejected" aria-label="Yêu cầu đổi lịch không được chấp nhận">
          <span className="reason-card-title">Yêu cầu đổi lịch không được chấp nhận</span>
          <dl className="summary">
            <dt>Giờ đã yêu cầu</dt>
            <dd>{formatDateTime(a.changeRejection.requestedStartTime)}</dd>
            <dt>Lý do từ chối</dt>
            <dd>{a.changeRejection.reason}</dd>
          </dl>
          <span className="caption">Lịch hẹn vẫn giữ nguyên giờ hiện tại. Thông báo đã được gửi tới email của bạn.</span>
        </section>
      )}
      {a.previousStartTime && a.changeReason && (
        <section className="reason-card" aria-label="Lịch đã được đổi">
          <span className="reason-card-title">Đã đổi lịch</span>
          <dl className="summary">
            <dt>Giờ cũ</dt>
            <dd>{formatDateTime(a.previousStartTime)}</dd>
            <dt>Lý do đổi lịch</dt>
            <dd>{a.changeReason}</dd>
          </dl>
        </section>
      )}
      {a.status === 'CANCELLED' && a.cancelReason && (
        <section className="reason-card" aria-label="Lý do hủy lịch">
          <span className="reason-card-title">Lý do hủy lịch</span>
          <p>{a.cancelReason}</p>
        </section>
      )}
    </>
  );
}

export function MyAppointmentsPage() {
  const { appointmentsVersion, notifyAppointmentsChanged } = useApp();
  const [tab, setTab] = useState<Tab>('upcoming');
  const [rescheduling, setRescheduling] = useState<Appointment | null>(null);
  const [cancelling, setCancelling] = useState<Appointment | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Tải lại mỗi khi lịch hẹn thay đổi, kể cả khi đặt qua chat.
  const list = useAsync((signal) => api.get<{ appointments: Appointment[] }>('/appointments/me', undefined, signal), [appointmentsVersion]);

  const groups = useMemo(() => {
    const all = list.data?.appointments ?? [];
    const now = Date.now();
    const upcoming = all.filter((a) => a.status === 'CONFIRMED' && new Date(a.endTime).getTime() > now);
    upcoming.sort((a, b) => a.startTime.localeCompare(b.startTime));
    return {
      upcoming,
      past: all.filter((a) => a.status === 'COMPLETED' || (a.status === 'CONFIRMED' && new Date(a.endTime).getTime() <= now)),
      cancelled: all.filter((a) => a.status === 'CANCELLED'),
    } satisfies Record<Tab, Appointment[]>;
  }, [list.data]);

  const done = (message: string) => {
    setRescheduling(null);
    setCancelling(null);
    setNotice(message);
    notifyAppointmentsChanged();
  };

  const items = groups[tab];

  return (
    <div className="container page">
      <div className="row-between">
        <div className="page-header">
          <h1>Lịch hẹn của tôi</h1>
          <p className="muted">Đổi hoặc hủy lịch trước giờ khám ít nhất 2 giờ. Đổi lịch cần phòng khám xác nhận.</p>
        </div>
        <Link to="/dat-lich" className="btn btn-primary">
          Đặt lịch mới
        </Link>
      </div>

      <div className="segmented" role="tablist" aria-label="Lọc lịch hẹn">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label} ({groups[t.id].length})
          </button>
        ))}
      </div>

      {notice && (
        <p className="alert alert-success" role="status">
          {notice}
        </p>
      )}
      {list.loading && !list.data && <Spinner />}
      <ErrorAlert message={list.error} />

      {list.data && items.length === 0 && (
        <Empty>{tab === 'upcoming' ? 'Bạn chưa có lịch hẹn sắp tới.' : 'Không có lịch hẹn nào.'}</Empty>
      )}

      <div className="stack">
        {items.map((a) => (
          <article key={a.id} className="card appt-card">
            <div className="stack" style={{ gap: 'var(--space-1)', flex: 1 }}>
              <div className="row">
                <StatusBadge status={a.pendingChange ? 'PENDING' : a.status} />
                {a.createdVia === 'CHATBOT' && <span className="badge badge-neutral">Đặt qua trợ lý</span>}
              </div>
              <h3>{formatDateTime(a.startTime)}</h3>
              <p className="small">
                Bác sĩ {a.doctor.fullName} · {a.doctor.specialty.name} · {formatMoney(a.doctor.fee)}
              </p>
              <p className="small muted">Lý do khám: {a.reason}</p>
            </div>
            {a.status === 'CONFIRMED' && (
              <div className="row appt-actions">
                {canChange(a) ? (
                  <>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setRescheduling(a)}>
                      {a.pendingChange ? 'Đổi yêu cầu' : 'Đổi lịch'}
                    </button>
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => setCancelling(a)}>
                      Hủy lịch
                    </button>
                  </>
                ) : (
                  <span className="caption">Còn dưới 2 giờ nên không đổi/hủy được</span>
                )}
              </div>
            )}
            <ReasonCards a={a} />
          </article>
        ))}
      </div>

      {rescheduling && (
        <RescheduleDialog
          appointment={rescheduling}
          onClose={() => setRescheduling(null)}
          onDone={() => done('Đã gửi yêu cầu đổi lịch. Lịch sẽ chuyển sang giờ mới khi phòng khám xác nhận.')}
        />
      )}
      {cancelling && <CancelDialog appointment={cancelling} onClose={() => setCancelling(null)} onDone={() => done('Đã hủy lịch hẹn.')} />}
    </div>
  );
}
