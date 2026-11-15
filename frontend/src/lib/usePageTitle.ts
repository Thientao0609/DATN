import { useEffect } from 'react';

const SITE = 'Phòng khám An Tâm';

/** Đặt tiêu đề tab trình duyệt theo trang, ví dụ "Bác sĩ – Phòng khám An Tâm". Không truyền gì: tiêu đề trang chủ. */
export function usePageTitle(title?: string): void {
  useEffect(() => {
    document.title = title ? `${title} – ${SITE}` : `${SITE} – Đặt lịch khám`;
  }, [title]);
}
