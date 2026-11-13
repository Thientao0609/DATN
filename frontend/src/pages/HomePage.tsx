import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { DateChips, SlotGrid, defaultBookingDate } from '../components/SlotPicker';
import { Empty, ErrorAlert, Spinner, initials } from '../components/common';
import { Icon } from '../components/Icon';
import { CLINIC } from '../components/Layout';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { formatMoney } from '../lib/time';
import type { Doctor, Slot, Specialty } from '../lib/types';
import { useAsync } from '../lib/useAsync';

function QuickBooking({ doctors }: { doctors: Doctor[] }) {
  const navigate = useNavigate();
  const [doctorId, setDoctorId] = useState(doctors[0]?.id ?? '');
  const [date, setDate] = useState(defaultBookingDate);
  const [slot, setSlot] = useState<Slot | null>(null);
  const doctor = doctors.find((d) => d.id === doctorId);

  const go = () => {
    const params = new URLSearchParams({ doctorId, date, ...(slot ? { startTime: slot.startTime } : {}) });
    navigate(`/dat-lich?${params.toString()}`);
  };

  return (
    <form
      className="card-elevated stack"
      aria-label="Đặt lịch nhanh"
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
    >
      <div>
        <h2 style={{ fontSize: 'var(--font-size-h3)' }}>Đặt lịch nhanh</h2>
        <p className="caption">Xem giờ trống không cần đăng nhập</p>
      </div>
      <label className="field">
        <span className="field-label">Bác sĩ</span>
        <select
          className="select"
          value={doctorId}
          onChange={(e) => {
            setDoctorId(e.target.value);
            setSlot(null);
          }}
        >
          {doctors.map((d) => (
            <option key={d.id} value={d.id}>
              {d.specialty.name} – BS. {d.fullName}
            </option>
          ))}
        </select>
      </label>
      <DateChips
        value={date}
        onChange={(d) => {
          setDate(d);
          setSlot(null);
        }}
      />
      {doctorId && <SlotGrid doctorId={doctorId} date={date} value={slot?.startTime ?? null} onChange={setSlot} />}
      <p className="small muted" aria-live="polite">
        {slot && doctor ? `Bạn chọn: ${doctor.specialty.name} · ${slot.time}, ${date.split('-').reverse().join('/')}` : 'Chọn một khung giờ để tiếp tục.'}
      </p>
      <button type="submit" className="btn btn-outline btn-block" disabled={!slot}>
        Tiếp tục
      </button>
    </form>
  );
}

export function HomePage() {
  const { openChat } = useApp();
  const { user } = useAuth();
  const data = useAsync(
    async (signal) => {
      const [s, d] = await Promise.all([
        api.get<{ specialties: Specialty[] }>('/specialties', undefined, signal),
        api.get<{ doctors: Doctor[] }>('/doctors', undefined, signal),
      ]);
      return { specialties: s.specialties, doctors: d.doctors };
    },
    [],
  );
  const askAssistant = () => openChat();
  const fees = data.data?.doctors.map((d) => d.fee) ?? [];

  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div className="hero-copy">
            <span className="eyebrow">Đặt lịch online 24/7</span>
            <h1>Đặt lịch khám bệnh, không cần xếp hàng lấy số</h1>
            <p>Chọn chuyên khoa và giờ khám phù hợp ngay trên web. Bạn có thể đổi hoặc hủy lịch trước giờ khám, không cần gọi điện.</p>
            <div className="row">
              <Link to="/dat-lich" className="btn btn-primary">
                Đặt lịch khám
              </Link>
              <button type="button" className="btn" onClick={askAssistant}>
                Chưa biết khám khoa nào?
              </button>
            </div>
            <ul className="check-list">
              <li>Không cần xếp hàng lấy số</li>
              <li>Đổi, hủy lịch ngay trên web</li>
              <li>Trợ lý AI gợi ý chuyên khoa</li>
            </ul>
          </div>
          {data.loading && <Spinner />}
          {data.error && <ErrorAlert message={data.error} />}
          {data.data && data.data.doctors.length > 0 && <QuickBooking doctors={data.data.doctors} />}
        </div>
      </section>

      <section className="section" id="chuyen-khoa">
        <div className="container">
          <div className="section-head">
            <div className="stack" style={{ gap: 'var(--space-1)' }}>
              <h2>Các chuyên khoa</h2>
              <p className="muted">Chọn chuyên khoa để xem bác sĩ và giờ còn trống.</p>
            </div>
            <button type="button" className="btn" onClick={askAssistant}>
              Chưa rõ khoa nào? Hỏi trợ lý
            </button>
          </div>
          {data.data && (
            <div className="grid">
              {data.data.specialties.map((s) => (
                <Link key={s.id} to={`/bac-si?specialtyId=${s.id}`} className="card card-link">
                  <h3>{s.name}</h3>
                  <p className="small muted">{s.description}</p>
                  <span className="small">Xem bác sĩ & giờ trống ›</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <h2>Bác sĩ của phòng khám</h2>
            <Link to="/bac-si">Xem tất cả bác sĩ ›</Link>
          </div>
          {data.data && data.data.doctors.length === 0 && <Empty>Chưa có bác sĩ.</Empty>}
          {data.data && (
            <div className="grid">
              {data.data.doctors.slice(0, 6).map((d) => (
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
                  <p className="small muted">Phí khám {formatMoney(d.fee)}</p>
                  <Link to={`/dat-lich?doctorId=${d.id}`} className="btn btn-outline btn-sm">
                    Đặt lịch
                  </Link>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="section">
        <div className="container stack-lg">
          <h2>Đặt lịch chỉ với 3 bước</h2>
          <ol className="steps">
            <li className="stack">
              <span className="step-num">1</span>
              <h3>Chọn chuyên khoa hoặc bác sĩ</h3>
              <p className="small muted">Chưa rõ khoa nào? Mô tả triệu chứng cho trợ lý.</p>
            </li>
            <li className="stack">
              <span className="step-num">2</span>
              <h3>Chọn ngày và giờ còn trống</h3>
              <p className="small muted">Mỗi lượt khám 30 phút. Giờ đã kín không chọn được.</p>
            </li>
            <li className="stack">
              <span className="step-num">3</span>
              <h3>Kiểm tra và xác nhận</h3>
              <p className="small muted">Lịch được xác nhận ngay. Bạn theo dõi trong mục Lịch hẹn của tôi.</p>
            </li>
          </ol>
          <p className="small muted">
            {CLINIC.hours.join(' · ')}
            {fees.length > 0 && ` · Phí khám từ ${formatMoney(Math.min(...fees))} đến ${formatMoney(Math.max(...fees))} tùy chuyên khoa.`}
          </p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="card-subtle grid-2" style={{ alignItems: 'center' }}>
            <div className="stack">
              <h2>Chưa biết nên khám khoa nào?</h2>
              <p className="muted">
                Trợ lý An Tâm gợi ý chuyên khoa theo triệu chứng, tìm giờ trống và đặt lịch giúp bạn ngay trong khung chat.
                {!user && ' Bạn cần đăng nhập để trò chuyện với trợ lý.'}
              </p>
              <p className="caption">Trợ lý chỉ gợi ý chuyên khoa, không thay thế chẩn đoán của bác sĩ.</p>
              <div>
                <button type="button" className="btn btn-outline" onClick={askAssistant}>
                  <Icon name="chat" /> Hỏi trợ lý ngay
                </button>
              </div>
            </div>
            <div className="stack" aria-hidden="true">
              <div className="chat-bubble chat-bubble-user">Tôi bị ù tai và đau họng 3 ngày nay</div>
              <div className="chat-bubble chat-bubble-bot">
                Bạn nên khám chuyên khoa <strong>Tai mũi họng</strong>. Thông tin chỉ mang tính tham khảo. Bạn muốn xem giờ trống ngày nào?
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="emergency" role="note">
            <span className="row">
              <Icon name="alert" />
              <strong>Trường hợp cấp cứu: đừng đặt lịch. Hãy gọi ngay 115 hoặc đến cơ sở y tế gần nhất.</strong>
            </span>
            <a href="tel:115" className="btn btn-danger-solid btn-sm">
              Gọi 115
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
