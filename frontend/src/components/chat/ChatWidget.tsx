import { useEffect } from 'react';
import { Link, useLocation } from 'react-router';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { Icon } from '../Icon';
import { Logo } from '../Logo';
import { CLINIC } from '../Layout';
import { ChatPanel } from './ChatPanel';

/** Nút mở trợ lý và khung chat. Khung chat chỉ hoạt động khi bệnh nhân đã đăng nhập. */
export function ChatWidget() {
  const { chatOpen, openChat, closeChat } = useApp();
  const { user, loading } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (!chatOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeChat();
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('chat-is-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('chat-is-open');
    };
  }, [chatOpen, closeChat]);

  // Bác sĩ và quản trị viên không dùng trợ lý đặt lịch.
  if (user && user.role !== 'PATIENT') return null;

  if (!chatOpen) {
    return (
      <button type="button" className="chat-launcher" onClick={() => openChat()} aria-label="Mở Trợ lý An Tâm">
        <Logo size={24} />
        <span>Hỏi trợ lý</span>
      </button>
    );
  }

  return (
    <section className="chat-panel" role="dialog" aria-label="Trợ lý An Tâm">
      <header className="chat-header">
        <span className="avatar chat-avatar" aria-hidden="true">
          <Logo size={24} />
        </span>
        <div className="chat-title">
          <h2>Trợ lý An Tâm</h2>
          <span className="caption">
            <span className="online-dot" aria-hidden="true" /> Đang trực tuyến ·{' '}
            <a href={`tel:${CLINIC.hotlineTel}`}>
              <Icon name="phone" size={12} /> {CLINIC.hotline}
            </a>
          </span>
        </div>
        <button type="button" className="icon-btn" aria-label="Đóng trợ lý" onClick={closeChat}>
          <Icon name="close" />
        </button>
      </header>
      <p className="chat-note" role="note">
        Trợ lý chỉ gợi ý chuyên khoa, không thay thế chẩn đoán của bác sĩ. Cấp cứu: gọi 115.
      </p>
      {loading ? null : user ? (
        <ChatPanel />
      ) : (
        <div className="chat-body chat-login">
          <div className="chat-bubble chat-bubble-bot">
            Xin chào! Hãy đăng nhập để trợ lý gợi ý chuyên khoa và đặt lịch khám giúp bạn.
          </div>
          <div className="row">
            <Link to="/dang-nhap" state={{ from: location.pathname }} className="btn btn-primary btn-sm" onClick={closeChat}>
              Đăng nhập
            </Link>
            <Link to="/dang-ky" state={{ from: location.pathname }} className="btn btn-sm" onClick={closeChat}>
              Tạo tài khoản
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
