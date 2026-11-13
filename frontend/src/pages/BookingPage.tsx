import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { DateChips, SlotGrid, defaultBookingDate, upcomingDates } from '../components/SlotPicker';
import { ErrorAlert, Spinner } from '../components/common';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { ApiError, api, errorMessage } from '../lib/api';
import { formatDateTime, formatMoney } from '../lib/time';
import type { Appointment, Doctor, Slot, Specialty } from '../lib/types';
import { useAsync } from '../lib/useAsync';

export function BookingPage() {
  const { user } = useAuth();
  const { notifyAppointmentsChanged } = useApp();
  const location = useLocation();
  const [params] = useSearchParams();

  const catalog = useAsync(async (signal) => {
    const [s, d] = await Promise.all([
      api.get<{ specialties: Specialty[] }>('/specialties', undefined, signal),
      api.get<{ doctors: Doctor[] }>('/doctors', undefined, signal),
    ]);
    return { specialties: s.specialties, doctors: d.doctors };
  }, []);

  const initialDate = params.get('date');
  const [specialtyId, setSpecialtyId] = useState(params.get('specialtyId') ?? '');
  const [doctorId, setDoctorId] = useState(params.get('doctorId') ?? '');
  const [date, setDate] = useState(initialDate && upcomingDates().includes(initialDate) ? initialDate : defaultBookingDate());
  const [slot, setSlot] = useState<Slot | null>(null);
  const [preferredStart, setPreferredStart] = useState(params.get('startTime'));
  const [reason, setReason] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [booked, setBooked] = useState<Appointment | null>(null);

  // Bác sĩ chọn sẵn từ đường dẫn: suy ra chuyên khoa.
  useEffect(() => {
    if (!catalog.data || !doctorId || specialtyId) return;
    const d = catalog.data.doctors.find((x) => x.id === doctorId);
    if (d) setSpecialtyId(d.specialty.id);
  }, [catalog.data, doctorId, specialtyId]);

  const doctors = useMemo(
    () => (catalog.data?.doctors ?? []).filter((d) => !specialtyId || d.specialty.id === specialtyId),
    [catalog.data, specialtyId],
  );
  const doctor = doctors.find((d) => d.id === doctorId) ?? null;

  const onSlotChange = useCallback((s: Slot | null) => {
    setSlot(s);
    setPreferredStart(null);
  }, []);

  // Khung giờ chọn sẵn từ trang chủ.
  const selected = slot?.startTime ?? preferredStart;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!doctor || !selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ appointment: Appointment }>('/appointments', { doctorId: doctor.id, startTime: selected, reason });
      setBooked(res.appointment);
      notifyAppointmentsChanged();
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError && (err.code === 'SLOT_TAKEN' || err.code === 'SLOT_INVALID')) {
        setSlot(null);
        setPreferredStart(null);
        setReloadKey((k) => k + 1);
      }
    } finally {
      setBusy(false);
    }
  };

  if (booked) {
    return (
      <div className="container page">
        <div className="card-elevated stack" role="status">
          <span className="badge badge-completed">Đặt lịch thành công</span>
          <h1 style={{ fontSize: 'var(--font-size-h2)' }}>Hẹn gặp bạn lúc {formatDateTime(booked.startTime)}</h1>
          <p className="muted">
            Bác sĩ {booked.doctor.fullName} · {booked.doctor.specialty.name} · Phí khám {formatMoney(booked.doctor.fee)}
          </p>
          <p className="small muted">Bạn có thể đổi hoặc hủy lịch trước giờ khám ít nhất 2 giờ.</p>
          <div className="row">
            <Link to="/lich-hen" className="btn btn-primary">
              Xem lịch hẹn của tôi
            </Link>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setBooked(null);
                setSlot(null);
                setReason('');
                setReloadKey((k) => k + 1);
              }}
            >
              Đặt thêm lịch
            </button>
          </div>
        </div>
      </div>
    );
  }

  const canBook = user?.role === 'PATIENT';
  const reasonOk = reason.trim().length >= 5 && reason.trim().length <= 500;

  return (
    <div className="container page">
      <div className="page-header">
        <h1>Đặt lịch khám</h1>
        <p className="muted">Chọn chuyên khoa, bác sĩ, ngày và giờ còn trống.</p>
      </div>

      {catalog.loading && <Spinner />}
      <ErrorAlert message={catalog.error} />

      {catalog.data && (
        <form className="grid-2" onSubmit={submit} style={{ alignItems: 'start' }}>
          <div className="card stack-lg">
            <label className="field">
              <span className="field-label">1. Chuyên khoa</span>
              <select
                className="select"
                value={specialtyId}
                onChange={(e) => {
                  setSpecialtyId(e.target.value);
                  setDoctorId('');
                  setSlot(null);
                  setPreferredStart(null);
                }}
              >
                <option value="">Tất cả chuyên khoa</option>
                {catalog.data.specialties.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">2. Bác sĩ</span>
              <select
                className="select"
                value={doctorId}
                onChange={(e) => {
                  setDoctorId(e.target.value);
                  setSlot(null);
                  setPreferredStart(null);
                }}
              >
                <option value="">Chọn bác sĩ</option>
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>
                    BS. {d.fullName} – {d.specialty.name} – {formatMoney(d.fee)}
                  </option>
                ))}
              </select>
            </label>
            {doctor && (
              <>
                <DateChips
                  label="3. Ngày khám"
                  value={date}
                  onChange={(d) => {
                    setDate(d);
                    setSlot(null);
                    setPreferredStart(null);
                  }}
                />
                <div className="field">
                  <span className="field-label">4. Giờ còn trống</span>
                  <SlotGrid doctorId={doctor.id} date={date} value={selected} onChange={onSlotChange} reloadKey={reloadKey} />
                </div>
              </>
            )}
          </div>

          <div className="card stack-lg">
            <h2 style={{ fontSize: 'var(--font-size-h3)' }}>Thông tin lịch hẹn</h2>
            <dl className="summary">
              <dt>Bác sĩ</dt>
              <dd>{doctor ? `BS. ${doctor.fullName} · ${doctor.specialty.name}` : 'Chưa chọn'}</dd>
              <dt>Thời gian</dt>
              <dd>{selected ? formatDateTime(selected) : 'Chưa chọn'}</dd>
              <dt>Phí khám</dt>
              <dd>{doctor ? formatMoney(doctor.fee) : '—'}</dd>
            </dl>
            <label className="field">
              <span className="field-label">5. Lý do khám</span>
              <textarea
                className="textarea"
                value={reason}
                maxLength={500}
                placeholder="Ví dụ: Nổi mẩn đỏ và ngứa ở tay khoảng một tuần"
                onChange={(e) => setReason(e.target.value)}
              />
              <span className="field-hint">Từ 5 đến 500 ký tự. Chỉ bạn và bác sĩ khám xem được nội dung này.</span>
            </label>
            <ErrorAlert message={error} />
            {canBook ? (
              <button type="submit" className="btn btn-primary btn-block" disabled={busy || !doctor || !selected || !reasonOk}>
                {busy ? 'Đang đặt lịch…' : 'Đặt lịch'}
              </button>
            ) : user ? (
              <p className="alert alert-info">Chỉ tài khoản bệnh nhân mới đặt được lịch khám.</p>
            ) : (
              <Link to="/dang-nhap" state={{ from: location.pathname + location.search }} className="btn btn-primary btn-block">
                Đăng nhập để đặt lịch
              </Link>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
