import { useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { Empty, ErrorAlert, Modal, Spinner } from '../components/common';
import { api, errorMessage } from '../lib/api';
import { formatDateTime, formatMoney } from '../lib/time';
import type { AdminDoctor, ClinicInfo, RescheduleRequest, Specialty, Stats, WorkingSchedule } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { usePageTitle } from '../lib/usePageTitle';

type Tab = 'stats' | 'requests' | 'specialties' | 'doctors' | 'schedules' | 'clinic';
const TABS: { id: Tab; label: string }[] = [
  { id: 'stats', label: 'Thống kê' },
  { id: 'requests', label: 'Yêu cầu đổi lịch' },
  { id: 'specialties', label: 'Chuyên khoa' },
  { id: 'doctors', label: 'Bác sĩ' },
  { id: 'schedules', label: 'Lịch làm việc' },
  { id: 'clinic', label: 'Thông tin phòng khám' },
];
const DAYS = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
const percent = (r: number) => `${(r * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`;

// ---------------------------------------------------------------------------
// Thống kê
// ---------------------------------------------------------------------------

function BarList({ rows, unit }: { rows: { label: string; value: number; note?: string }[]; unit: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <Empty>Chưa có dữ liệu.</Empty>;
  return (
    <ul className="bar-list">
      {rows.map((r) => (
        <li key={r.label} className="bar-row" title={`${r.label}: ${r.value} ${unit}${r.note ? ` (${r.note})` : ''}`}>
          <span>{r.label}</span>
          <span className="bar-track" aria-hidden="true">
            <span className="bar-fill" style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="bar-value">
            {r.value} {unit}
            {r.note && <span className="caption"> · {r.note}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function StatsTab() {
  const stats = useAsync((signal) => api.get<Stats>('/admin/stats', undefined, signal), []);
  if (stats.loading && !stats.data) return <Spinner />;
  if (stats.error) return <ErrorAlert message={stats.error} />;
  const s = stats.data;
  if (!s) return null;
  return (
    <div className="stack-lg">
      <div className="stat-tiles">
        <div className="stat-tile">
          <span className="caption">Tổng lịch hẹn</span>
          <strong>{s.totals.appointments}</strong>
          <span className="caption">
            {s.totals.confirmed} sắp tới · {s.totals.completed} đã khám
            {s.totals.pendingReschedules > 0 && ` · ${s.totals.pendingReschedules} yêu cầu đổi lịch chờ duyệt`}
          </span>
        </div>
        <div className="stat-tile">
          <span className="caption">Tỉ lệ hủy</span>
          <strong>{percent(s.cancelRate)}</strong>
          <span className="caption">{s.totals.cancelled} lịch đã hủy</span>
        </div>
        <div className="stat-tile">
          <span className="caption">Đặt qua trợ lý AI</span>
          <strong>{percent(s.chatbotRate)}</strong>
          <span className="caption">
            {s.totals.viaChatbot} qua chat · {s.totals.viaForm} qua form
          </span>
        </div>
      </div>
      <div className="grid-2">
        <section className="card stack">
          <h3>Số lịch hẹn theo chuyên khoa</h3>
          <BarList
            unit="lịch"
            rows={[...s.bySpecialty]
              .sort((a, b) => b.total - a.total)
              .map((x) => ({ label: x.name, value: x.total, note: x.cancelled > 0 ? `${x.cancelled} hủy` : undefined }))}
          />
        </section>
        <section className="card stack">
          <h3>Khung giờ đông nhất</h3>
          <p className="caption">Số lịch chưa hủy theo giờ bắt đầu</p>
          <BarList unit="lịch" rows={s.busiestSlots.map((x) => ({ label: x.time, value: x.count }))} />
        </section>
      </div>
      <p className="caption">Thống kê không hiển thị lý do khám của bệnh nhân.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Khung CRUD dùng chung
// ---------------------------------------------------------------------------

function FormDialog({ title, onClose, onSubmit, children, submitLabel = 'Lưu' }: { title: string; onClose: () => void; onSubmit: () => Promise<void>; children: ReactNode; submitLabel?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={title} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        {children}
        <ErrorAlert message={error} />
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Hủy
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Đang lưu…' : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function useDelete(reload: () => void) {
  const [error, setError] = useState<string | null>(null);
  const remove = async (path: string, label: string) => {
    if (!window.confirm(`Xóa ${label}? Thao tác này không hoàn tác được.`)) return;
    setError(null);
    try {
      await api.delete(path);
      reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return { error, remove };
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Yêu cầu đổi lịch
// ---------------------------------------------------------------------------

function RescheduleRequestsTab() {
  const list = useAsync((signal) => api.get<{ requests: RescheduleRequest[] }>('/admin/reschedule-requests', undefined, signal), []);
  const [rejecting, setRejecting] = useState<RescheduleRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const approve = async (r: RescheduleRequest) => {
    setBusyId(r.appointmentId);
    setError(null);
    setNotice(null);
    try {
      await api.post(`/admin/reschedule-requests/${r.appointmentId}/approve`);
      setNotice(`Đã duyệt: lịch của ${r.patient.fullName} chuyển sang ${formatDateTime(r.requestedStartTime)}.`);
      list.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const requests = list.data?.requests ?? [];
  return (
    <div className="stack">
      <p className="muted small">
        Bệnh nhân gửi yêu cầu đổi lịch; trong lúc chờ, lịch cũ vẫn được giữ và giờ mới được giữ chỗ. Duyệt thì lịch chuyển sang giờ mới; từ chối thì lịch
        giữ nguyên giờ cũ và bệnh nhân nhận email thông báo kèm lý do.
      </p>
      {notice && (
        <p className="alert alert-success" role="status">
          {notice}
        </p>
      )}
      <ErrorAlert message={list.error ?? error} />
      {list.loading && !list.data && <Spinner />}
      {list.data && requests.length === 0 && <Empty>Không có yêu cầu đổi lịch nào đang chờ duyệt.</Empty>}
      {requests.map((r) => (
        <article key={r.appointmentId} className="card stack">
          <div className="row-between" style={{ alignItems: 'flex-start' }}>
            <div className="stack" style={{ gap: 'var(--space-1)' }}>
              <h3>{r.patient.fullName}</h3>
              <span className="caption">
                {r.patient.phone ?? 'Không có số điện thoại'} · BS. {r.doctor.fullName} · {r.doctor.specialty.name}
              </span>
            </div>
            <span className="badge badge-pending">Chờ xác nhận</span>
          </div>
          <dl className="summary small">
            <dt>Giờ hiện tại</dt>
            <dd>{formatDateTime(r.currentStartTime)}</dd>
            <dt>Giờ muốn đổi</dt>
            <dd>
              <strong>{formatDateTime(r.requestedStartTime)}</strong>
            </dd>
            <dt>Lý do đổi lịch</dt>
            <dd>{r.changeReason}</dd>
            <dt>Gửi lúc</dt>
            <dd>
              {formatDateTime(r.requestedAt)}
              {r.createdVia === 'CHATBOT' ? ' · qua trợ lý AI' : ''}
            </dd>
          </dl>
          <div className="row">
            <button type="button" className="btn btn-outline btn-sm" disabled={busyId === r.appointmentId} onClick={() => void approve(r)}>
              {busyId === r.appointmentId ? 'Đang duyệt…' : 'Duyệt'}
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={busyId === r.appointmentId}
              onClick={() => {
                setRejectReason('');
                setRejecting(r);
              }}
            >
              Từ chối
            </button>
          </div>
        </article>
      ))}
      {rejecting && (
        <FormDialog
          title="Từ chối yêu cầu đổi lịch"
          submitLabel="Từ chối và gửi email"
          onClose={() => setRejecting(null)}
          onSubmit={async () => {
            const res = await api.post<{ emailSent: boolean }>(`/admin/reschedule-requests/${rejecting.appointmentId}/reject`, { reason: rejectReason });
            setNotice(
              res.emailSent
                ? `Đã từ chối và gửi email thông báo cho ${rejecting.patient.fullName}. Lịch giữ nguyên giờ cũ.`
                : `Đã từ chối yêu cầu nhưng chưa gửi được email cho ${rejecting.patient.fullName}. Lịch giữ nguyên giờ cũ.`,
            );
            list.reload();
          }}
        >
          <p className="small muted">
            {rejecting.patient.fullName} muốn đổi từ {formatDateTime(rejecting.currentStartTime)} sang {formatDateTime(rejecting.requestedStartTime)}. Lịch sẽ
            giữ nguyên giờ cũ.
          </p>
          <Field label="Lý do từ chối" hint="Bắt buộc, từ 5 đến 500 ký tự. Lý do này được gửi tới email của bệnh nhân.">
            <textarea className="textarea" required minLength={5} maxLength={500} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
          </Field>
        </FormDialog>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chuyên khoa
// ---------------------------------------------------------------------------

function SpecialtiesTab() {
  const list = useAsync((signal) => api.get<{ specialties: Specialty[] }>('/admin/specialties', undefined, signal), []);
  const [editing, setEditing] = useState<Specialty | 'new' | null>(null);
  const del = useDelete(list.reload);
  const [form, setForm] = useState({ name: '', description: '', symptomHints: '' });

  const open = (s: Specialty | 'new') => {
    setForm(s === 'new' ? { name: '', description: '', symptomHints: '' } : { name: s.name, description: s.description, symptomHints: s.symptomHints });
    setEditing(s);
  };

  return (
    <div className="stack">
      <div className="admin-toolbar">
        <p className="muted small">Triệu chứng gợi ý giúp trợ lý AI đề xuất đúng chuyên khoa.</p>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => open('new')}>
          Thêm chuyên khoa
        </button>
      </div>
      <ErrorAlert message={list.error ?? del.error} />
      {list.data && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Tên</th>
                <th>Triệu chứng gợi ý</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {list.data.specialties.map((s) => (
                <tr key={s.id}>
                  <td>
                    <strong>{s.name}</strong>
                    <div className="caption">{s.description}</div>
                  </td>
                  <td className="small">{s.symptomHints}</td>
                  <td>
                    <div className="row">
                      <button type="button" className="btn btn-sm" onClick={() => open(s)}>
                        Sửa
                      </button>
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => void del.remove(`/admin/specialties/${s.id}`, `chuyên khoa ${s.name}`)}>
                        Xóa
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <FormDialog
          title={editing === 'new' ? 'Thêm chuyên khoa' : 'Sửa chuyên khoa'}
          onClose={() => setEditing(null)}
          onSubmit={async () => {
            if (editing === 'new') await api.post('/admin/specialties', form);
            else await api.patch(`/admin/specialties/${editing.id}`, form);
            list.reload();
          }}
        >
          <Field label="Tên chuyên khoa">
            <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Mô tả">
            <textarea className="textarea" required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Field label="Triệu chứng gợi ý" hint="Các triệu chứng thường gặp, cách nhau bằng dấu phẩy.">
            <textarea className="textarea" required value={form.symptomHints} onChange={(e) => setForm({ ...form, symptomHints: e.target.value })} />
          </Field>
        </FormDialog>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bác sĩ
// ---------------------------------------------------------------------------

interface DoctorForm {
  email: string;
  password: string;
  fullName: string;
  phone: string;
  specialtyId: string;
  bio: string;
  fee: string;
  slotMinutes: string;
}

function DoctorsTab() {
  const list = useAsync(async (signal) => {
    const [d, s] = await Promise.all([
      api.get<{ doctors: AdminDoctor[] }>('/admin/doctors', undefined, signal),
      api.get<{ specialties: Specialty[] }>('/admin/specialties', undefined, signal),
    ]);
    return { doctors: d.doctors, specialties: s.specialties };
  }, []);
  const [editing, setEditing] = useState<AdminDoctor | 'new' | null>(null);
  const del = useDelete(list.reload);
  const empty: DoctorForm = { email: '', password: '', fullName: '', phone: '', specialtyId: '', bio: '', fee: '200000', slotMinutes: '30' };
  const [form, setForm] = useState<DoctorForm>(empty);
  const set = (k: keyof DoctorForm) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const open = (d: AdminDoctor | 'new') => {
    setForm(
      d === 'new'
        ? { ...empty, specialtyId: list.data?.specialties[0]?.id ?? '' }
        : { ...empty, fullName: d.fullName, phone: d.phone ?? '', specialtyId: d.specialty.id, bio: d.bio, fee: String(d.fee), slotMinutes: String(d.slotMinutes) },
    );
    setEditing(d);
  };

  return (
    <div className="stack">
      <div className="admin-toolbar">
        <p className="muted small">Tài khoản bác sĩ chỉ được tạo ở đây. Bác sĩ đã có lịch hẹn thì không xóa được.</p>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => open('new')}>
          Thêm bác sĩ
        </button>
      </div>
      <ErrorAlert message={list.error ?? del.error} />
      {list.data && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Bác sĩ</th>
                <th>Chuyên khoa</th>
                <th>Phí khám</th>
                <th>Khung</th>
                <th>Lịch hẹn</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {list.data.doctors.map((d) => (
                <tr key={d.id}>
                  <td>
                    <strong>BS. {d.fullName}</strong>
                    <div className="caption">{d.email}</div>
                  </td>
                  <td>{d.specialty.name}</td>
                  <td>{formatMoney(d.fee)}</td>
                  <td>{d.slotMinutes} phút</td>
                  <td>{d.appointmentCount}</td>
                  <td>
                    <div className="row">
                      <button type="button" className="btn btn-sm" onClick={() => open(d)}>
                        Sửa
                      </button>
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => void del.remove(`/admin/doctors/${d.id}`, `bác sĩ ${d.fullName}`)}>
                        Xóa
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && list.data && (
        <FormDialog
          title={editing === 'new' ? 'Thêm bác sĩ' : `Sửa BS. ${editing.fullName}`}
          onClose={() => setEditing(null)}
          onSubmit={async () => {
            const common = {
              fullName: form.fullName,
              ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
              specialtyId: form.specialtyId,
              bio: form.bio,
              fee: Number(form.fee),
              slotMinutes: Number(form.slotMinutes),
            };
            if (editing === 'new') await api.post('/admin/doctors', { ...common, email: form.email, password: form.password });
            else await api.patch(`/admin/doctors/${editing.id}`, common);
            list.reload();
          }}
        >
          {editing === 'new' && (
            <>
              <Field label="Email đăng nhập">
                <input className="input" type="email" required value={form.email} onChange={set('email')} />
              </Field>
              <Field label="Mật khẩu" hint="Tối thiểu 8 ký tự.">
                <input className="input" type="password" required minLength={8} value={form.password} onChange={set('password')} />
              </Field>
            </>
          )}
          <Field label="Họ và tên">
            <input className="input" required value={form.fullName} onChange={set('fullName')} />
          </Field>
          <Field label="Số điện thoại">
            <input className="input" type="tel" value={form.phone} onChange={set('phone')} />
          </Field>
          <Field label="Chuyên khoa">
            <select className="select" value={form.specialtyId} onChange={set('specialtyId')}>
              {list.data.specialties.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Giới thiệu">
            <textarea className="textarea" required value={form.bio} onChange={set('bio')} />
          </Field>
          <div className="grid-2">
            <Field label="Phí khám (VND)">
              <input className="input" type="number" min={0} step={1000} required value={form.fee} onChange={set('fee')} />
            </Field>
            <Field label="Thời lượng khung (phút)">
              <input className="input" type="number" min={10} max={240} step={5} required value={form.slotMinutes} onChange={set('slotMinutes')} />
            </Field>
          </div>
        </FormDialog>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lịch làm việc
// ---------------------------------------------------------------------------

function SchedulesTab() {
  const doctors = useAsync((signal) => api.get<{ doctors: AdminDoctor[] }>('/admin/doctors', undefined, signal), []);
  const [doctorId, setDoctorId] = useState('');
  const current = doctorId || doctors.data?.doctors[0]?.id || '';
  const list = useAsync(
    async (signal) => (current ? (await api.get<{ schedules: WorkingSchedule[] }>('/admin/schedules', { doctorId: current }, signal)).schedules : []),
    [current],
  );
  const [editing, setEditing] = useState<WorkingSchedule | 'new' | null>(null);
  const [form, setForm] = useState({ dayOfWeek: '1', startTime: '08:00', endTime: '11:30' });
  const del = useDelete(list.reload);

  const open = (s: WorkingSchedule | 'new') => {
    setForm(s === 'new' ? { dayOfWeek: '1', startTime: '08:00', endTime: '11:30' } : { dayOfWeek: String(s.dayOfWeek), startTime: s.startTime, endTime: s.endTime });
    setEditing(s);
  };

  return (
    <div className="stack">
      <div className="admin-toolbar">
        <label className="field cal-filter">
          <span className="field-label">Bác sĩ</span>
          <select className="select" value={current} onChange={(e) => setDoctorId(e.target.value)}>
            {doctors.data?.doctors.map((d) => (
              <option key={d.id} value={d.id}>
                BS. {d.fullName} · {d.specialty.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-primary btn-sm" disabled={!current} onClick={() => open('new')}>
          Thêm khoảng làm việc
        </button>
      </div>
      <p className="caption">Đổi lịch làm việc không ảnh hưởng các lịch hẹn đã đặt.</p>
      <ErrorAlert message={doctors.error ?? list.error ?? del.error} />
      {list.data && list.data.length === 0 && <Empty>Bác sĩ này chưa có lịch làm việc.</Empty>}
      {list.data && list.data.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Thứ</th>
                <th>Giờ làm việc</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {[...list.data]
                .sort((a, b) => ((a.dayOfWeek + 6) % 7) - ((b.dayOfWeek + 6) % 7) || a.startTime.localeCompare(b.startTime))
                .map((s) => (
                  <tr key={s.id}>
                    <td>{DAYS[s.dayOfWeek]}</td>
                    <td>
                      {s.startTime} – {s.endTime}
                    </td>
                    <td>
                      <div className="row">
                        <button type="button" className="btn btn-sm" onClick={() => open(s)}>
                          Sửa
                        </button>
                        <button type="button" className="btn btn-danger btn-sm" onClick={() => void del.remove(`/admin/schedules/${s.id}`, `lịch ${DAYS[s.dayOfWeek]} ${s.startTime}–${s.endTime}`)}>
                          Xóa
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <FormDialog
          title={editing === 'new' ? 'Thêm khoảng làm việc' : 'Sửa khoảng làm việc'}
          onClose={() => setEditing(null)}
          onSubmit={async () => {
            const body = { dayOfWeek: Number(form.dayOfWeek), startTime: form.startTime, endTime: form.endTime };
            if (editing === 'new') await api.post('/admin/schedules', { ...body, doctorId: current });
            else await api.patch(`/admin/schedules/${editing.id}`, body);
            list.reload();
          }}
        >
          <Field label="Thứ">
            <select className="select" value={form.dayOfWeek} onChange={(e) => setForm({ ...form, dayOfWeek: e.target.value })}>
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <option key={d} value={d}>
                  {DAYS[d]}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid-2">
            <Field label="Bắt đầu">
              <input className="input" type="time" required value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
            </Field>
            <Field label="Kết thúc">
              <input className="input" type="time" required value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
            </Field>
          </div>
        </FormDialog>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thông tin phòng khám
// ---------------------------------------------------------------------------

function ClinicInfoTab() {
  const list = useAsync((signal) => api.get<{ items: ClinicInfo[] }>('/admin/clinic-info', undefined, signal), []);
  const [editing, setEditing] = useState<ClinicInfo | 'new' | null>(null);
  const [form, setForm] = useState({ topic: '', content: '' });
  const del = useDelete(list.reload);
  const open = (c: ClinicInfo | 'new') => {
    setForm(c === 'new' ? { topic: '', content: '' } : { topic: c.topic, content: c.content });
    setEditing(c);
  };
  return (
    <div className="stack">
      <div className="admin-toolbar">
        <p className="muted small">Trợ lý AI và trang Câu hỏi thường gặp (công khai) lấy giờ làm việc, bảng giá, hướng dẫn… từ các mục này.</p>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => open('new')}>
          Thêm mục
        </button>
      </div>
      <ErrorAlert message={list.error ?? del.error} />
      <div className="stack">
        {list.data?.items.map((c) => (
          <article key={c.id} className="card row-between" style={{ alignItems: 'flex-start' }}>
            <div className="stack" style={{ gap: 'var(--space-1)', flex: 1, minWidth: 0 }}>
              <h3>{c.topic}</h3>
              <p className="small muted">{c.content}</p>
            </div>
            <div className="row">
              <button type="button" className="btn btn-sm" onClick={() => open(c)}>
                Sửa
              </button>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => void del.remove(`/admin/clinic-info/${c.id}`, `mục ${c.topic}`)}>
                Xóa
              </button>
            </div>
          </article>
        ))}
      </div>
      {editing && (
        <FormDialog
          title={editing === 'new' ? 'Thêm mục thông tin' : 'Sửa mục thông tin'}
          onClose={() => setEditing(null)}
          onSubmit={async () => {
            if (editing === 'new') await api.post('/admin/clinic-info', form);
            else await api.patch(`/admin/clinic-info/${editing.id}`, form);
            list.reload();
          }}
        >
          <Field label="Chủ đề">
            <input className="input" required value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} />
          </Field>
          <Field label="Nội dung">
            <textarea className="textarea" required value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
          </Field>
        </FormDialog>
      )}
    </div>
  );
}

export function AdminPage() {
  usePageTitle('Quản trị');
  const [params] = useSearchParams();
  const initial = params.get('tab');
  const [tab, setTab] = useState<Tab>(TABS.some((t) => t.id === initial) ? (initial as Tab) : 'stats');
  return (
    <div className="container page">
      <div className="page-header">
        <h1>Quản trị</h1>
        <p className="muted">Dữ liệu nền của phòng khám và thống kê đặt lịch.</p>
      </div>
      <div className="segmented" role="tablist" aria-label="Mục quản trị">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'stats' && <StatsTab />}
      {tab === 'requests' && <RescheduleRequestsTab />}
      {tab === 'specialties' && <SpecialtiesTab />}
      {tab === 'doctors' && <DoctorsTab />}
      {tab === 'schedules' && <SchedulesTab />}
      {tab === 'clinic' && <ClinicInfoTab />}
    </div>
  );
}
