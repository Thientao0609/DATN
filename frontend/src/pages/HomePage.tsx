import { Link } from 'react-router';
import { QuickScheduler } from '../components/QuickScheduler';
import { Empty, ErrorAlert, Spinner, initials } from '../components/common';
import { Icon } from '../components/Icon';
import { CLINIC } from '../components/Layout';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { formatMoney } from '../lib/time';
import type { Doctor, Specialty } from '../lib/types';
import { useAsync } from '../lib/useAsync';

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
          <aside className="card-elevated steps-card" aria-labelledby="steps-title">
            <h2 id="steps-title">Đặt lịch chỉ với 3 bước</h2>
            <ol className="steps-vertical">
              <li>
                <span className="step-num">1</span>
                <div>
                  <h3>Chọn chuyên khoa hoặc bác sĩ</h3>
                  <p>Chưa rõ khoa nào? Mô tả triệu chứng cho trợ lý.</p>
                </div>
              </li>
              <li>
                <span className="step-num">2</span>
                <div>
                  <h3>Chọn ngày và giờ còn trống</h3>
                  <p>Mỗi lượt khám 30 phút. Giờ đã kín không chọn được.</p>
                </div>
              </li>
              <li>
                <span className="step-num">3</span>
                <div>
                  <h3>Kiểm tra và xác nhận</h3>
                  <p>Lịch được xác nhận ngay. Bạn theo dõi trong mục Lịch hẹn của tôi.</p>
                </div>
              </li>
            </ol>
            <p className="caption">
              {CLINIC.hours.join(' · ')}
              {fees.length > 0 && ` · Phí khám từ ${formatMoney(Math.min(...fees))} đến ${formatMoney(Math.max(...fees))} tùy chuyên khoa.`}
            </p>
            <a href="#dat-lich-nhanh" className="btn btn-outline btn-sm">
              Xem giờ trống ngay
            </a>
          </aside>
        </div>
      </section>

      <section className="section" id="dat-lich-nhanh">
        <div className="container">
          {data.loading && <Spinner />}
          {data.error && <ErrorAlert message={data.error} />}
          {data.data && data.data.doctors.length > 0 && <QuickScheduler doctors={data.data.doctors} />}
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
