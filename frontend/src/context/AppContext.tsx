import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface AppState {
  /** Tăng mỗi khi lịch hẹn thay đổi (đặt qua chat, đổi, hủy) để các trang tải lại. */
  appointmentsVersion: number;
  notifyAppointmentsChanged: () => void;
  chatOpen: boolean;
  /** Mở khung chat; có thể kèm một tin nhắn gửi ngay. */
  openChat: (message?: string) => void;
  closeChat: () => void;
  /** Tin nhắn chờ gửi khi khung chat mở. */
  queuedMessage: string | null;
  takeQueuedMessage: () => string | null;
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [appointmentsVersion, setVersion] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const [queuedMessage, setQueued] = useState<string | null>(null);

  const notifyAppointmentsChanged = useCallback(() => setVersion((v) => v + 1), []);
  const openChat = useCallback((message?: string) => {
    if (message) setQueued(message);
    setChatOpen(true);
  }, []);
  const closeChat = useCallback(() => setChatOpen(false), []);
  const takeQueuedMessage = useCallback(() => {
    const m = queuedMessage;
    setQueued(null);
    return m;
  }, [queuedMessage]);

  const value = useMemo(
    () => ({ appointmentsVersion, notifyAppointmentsChanged, chatOpen, openChat, closeChat, queuedMessage, takeQueuedMessage }),
    [appointmentsVersion, notifyAppointmentsChanged, chatOpen, openChat, closeChat, queuedMessage, takeQueuedMessage],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp phải dùng bên trong AppProvider');
  return ctx;
}
