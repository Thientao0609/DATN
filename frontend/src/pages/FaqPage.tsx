import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ErrorAlert, Spinner } from '../components/common';
import { Icon } from '../components/Icon';
import { CLINIC } from '../components/Layout';
import { useApp } from '../context/AppContext';
import { api } from '../lib/api';
import type { ClinicInfo } from '../lib/types';
import { useAsync } from '../lib/useAsync';

interface Faq {
  id: string;
  question: string;
  /** Văn bản thuần dùng để tìm kiếm. */
  text: string;
  answer: ReactNode;
}

interface FaqGroup {
  id: string;
  title: string;
  items: Faq[];
}

/** Bỏ dấu tiếng Việt, chữ thường — để tìm "huy lich" vẫn ra "Hủy lịch". */
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

function faq(id: string, question: string, text: string, extra?: ReactNode): Faq {
  return {
    id,
    question,
    text,
    answer: (
      <>
        <p>{text}</p>
        {extra}
      </>
    ),
  };
}

// Các câu trả lời khớp với quy tắc nghiệp vụ của backend (spec mục 6, 7).
const STATIC_GROUPS: FaqGroup[] = [
  {
    id: 'dat-lich',
    title: 'Đặt lịch khám',
    items: [
      faq(
        'cach-dat-lich',
        'Tôi đặt lịch khám như thế nào?',
        'Vào mục Đặt lịch khám, chọn chuyên khoa, bác sĩ, ngày và khung giờ còn trống, nhập lý do khám rồi bấm Đặt lịch. Lịch được xác nhận ngay, không cần chờ phòng khám gọi lại. Bạn cũng có thể nhờ Trợ lý An Tâm đặt giúp trong khung chat.',
        <Link to="/dat-lich">Đặt lịch khám ›</Link>,
      ),
      faq(
        'tai-khoan',
        'Có cần tài khoản để đặt lịch không?',
        'Bạn xem được bác sĩ và giờ còn trống mà không cần đăng nhập. Để đặt, đổi, hủy lịch và trò chuyện với trợ lý, bạn cần tài khoản bệnh nhân, đăng ký miễn phí bằng email.',
        <Link to="/dang-ky">Tạo tài khoản ›</Link>,
      ),
      faq(
        'dat-truoc',
        'Tôi đặt lịch trước được bao lâu?',
        'Bạn đặt được lịch trong vòng 30 ngày tới. Khung giờ phải bắt đầu sau thời điểm hiện tại ít nhất 60 phút. Mỗi lượt khám kéo dài 30 phút.',
      ),
      faq(
        'so-lich',
        'Tôi được giữ bao nhiêu lịch hẹn cùng lúc?',
        'Mỗi người có tối đa 3 lịch hẹn sắp tới và không được có hai lịch trùng giờ nhau. Khi một lịch đã khám xong hoặc bị hủy, bạn đặt thêm được.',
      ),
      faq(
        'vua-co-nguoi-dat',
        'Vì sao khung giờ tôi chọn báo "vừa có người đặt"?',
        'Mỗi khung giờ của một bác sĩ chỉ nhận một lịch hẹn. Nếu người khác xác nhận trước bạn vài giây, hệ thống báo lỗi và tải lại danh sách giờ trống để bạn chọn khung khác.',
      ),
    ],
  },
  {
    id: 'doi-huy',
    title: 'Đổi và hủy lịch',
    items: [
      faq(
        'cach-doi-huy',
        'Làm sao để đổi hoặc hủy lịch?',
        'Vào Lịch hẹn của tôi, chọn Đổi lịch hoặc Hủy lịch ở lịch muốn thay đổi. Bạn cũng có thể nhắn cho Trợ lý An Tâm, trợ lý sẽ gửi thẻ xác nhận để bạn bấm Đồng ý.',
        <Link to="/lich-hen">Lịch hẹn của tôi ›</Link>,
      ),
      faq(
        'han-doi-huy',
        'Tôi đổi hoặc hủy lịch đến khi nào?',
        `Bạn đổi hoặc hủy lịch online được nếu còn ít nhất 2 giờ trước giờ khám. Muộn hơn, vui lòng gọi hotline ${CLINIC.hotline} để được hỗ trợ.`,
      ),
      faq(
        'khung-gio-mo-lai',
        'Khung giờ đã hủy có được mở lại không?',
        'Có. Ngay khi bạn hủy, khung giờ đó trở lại trống và người khác đặt được. Lịch đã hủy vẫn nằm trong mục Đã hủy để bạn tiện theo dõi.',
      ),
    ],
  },
  {
    id: 'tro-ly',
    title: 'Trợ lý AI',
    items: [
      faq(
        'tro-ly-lam-gi',
        'Trợ lý An Tâm làm được gì?',
        'Trợ lý gợi ý chuyên khoa theo triệu chứng, tìm bác sĩ và giờ còn trống, đặt, đổi, hủy lịch giúp bạn và trả lời câu hỏi về phòng khám như giờ làm việc, bảng giá, giấy tờ cần mang.',
      ),
      faq(
        'tro-ly-tu-dat',
        'Trợ lý có tự đặt lịch mà không hỏi tôi không?',
        'Không. Trợ lý chỉ đề xuất. Lịch chỉ được ghi khi bạn bấm Đồng ý trên thẻ xác nhận hiện trong khung chat; đề xuất tự hết hạn sau 10 phút nếu bạn không xác nhận.',
      ),
      faq(
        'chan-doan',
        'Trợ lý có chẩn đoán bệnh hay kê thuốc không?',
        'Không. Trợ lý chỉ gợi ý chuyên khoa và thông tin mang tính tham khảo, không chẩn đoán, không kê thuốc. Bác sĩ sẽ khám và tư vấn cho bạn.',
      ),
      faq(
        'cap-cuu',
        'Khi có dấu hiệu cấp cứu thì làm gì?',
        'Đừng đặt lịch khám thường. Hãy gọi ngay 115 hoặc đến cơ sở cấp cứu gần nhất nếu có đau ngực dữ dội, khó thở, yếu liệt đột ngột, chảy máu không cầm hoặc mất ý thức.',
        <a href="tel:115" className="btn btn-danger-solid btn-sm">
          <Icon name="phone" size={16} /> Gọi 115
        </a>,
      ),
      faq(
        'bao-mat',
        'Lý do khám của tôi có được bảo mật không?',
        'Lý do khám là dữ liệu sức khỏe: chỉ bạn và bác sĩ khám lịch đó xem được. Quản trị viên và các số liệu thống kê không hiển thị nội dung này.',
      ),
    ],
  },
];

function FaqItem({ item, open }: { item: Faq; open: boolean }) {
  return (
    <details className="faq-item" id={item.id} open={open}>
      <summary>
        <span>{item.question}</span>
        <Icon name="right" size={18} className="faq-chevron" />
      </summary>
      <div className="faq-answer">{item.answer}</div>
    </details>
  );
}

export function FaqPage() {
  const { openChat } = useApp();
  const [query, setQuery] = useState('');
  const info = useAsync((signal) => api.get<{ items: ClinicInfo[] }>('/clinic-info', undefined, signal), []);

  const groups = useMemo<FaqGroup[]>(() => {
    const clinic: FaqGroup = {
      id: 'phong-kham',
      title: 'Thông tin phòng khám',
      items: (info.data?.items ?? []).map((c) => ({
        id: `info-${c.id}`,
        question: c.topic,
        text: c.content,
        answer: <p>{c.content}</p>,
      })),
    };
    return [...STATIC_GROUPS, clinic];
  }, [info.data]);

  const q = normalize(query.trim());
  const filtered = q
    ? groups
        .map((g) => ({ ...g, items: g.items.filter((i) => normalize(`${i.question} ${i.text}`).includes(q)) }))
        .filter((g) => g.items.length > 0)
    : groups;
  const total = filtered.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="container page faq-page">
      <div className="page-header">
        <h1>Câu hỏi thường gặp</h1>
        <p className="muted">Đặt lịch, đổi hủy lịch, trợ lý AI và thông tin phòng khám.</p>
      </div>

      <div className="stack">
        <label className="sr-only" htmlFor="faq-search">
          Tìm câu hỏi
        </label>
        <input
          id="faq-search"
          className="input"
          type="search"
          placeholder="Tìm câu hỏi, ví dụ: hủy lịch, bảo hiểm, giờ làm việc"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {!q && (
          <nav className="chip-row" aria-label="Nhóm câu hỏi">
            {groups.map((g) => (
              <a key={g.id} href={`#${g.id}`} className="chip faq-chip">
                {g.title}
              </a>
            ))}
          </nav>
        )}
        {q && (
          <p className="small muted" aria-live="polite">
            {total > 0 ? `${total} câu hỏi phù hợp` : 'Không tìm thấy câu hỏi phù hợp.'}
          </p>
        )}
      </div>

      {filtered.map((g) => (
        <section key={g.id} id={g.id} className="faq-group" aria-labelledby={`${g.id}-title`}>
          <h2 id={`${g.id}-title`}>{g.title}</h2>
          {g.id === 'phong-kham' && info.loading && !info.data && <Spinner />}
          {g.id === 'phong-kham' && <ErrorAlert message={info.error} />}
          <div className="faq-list">
            {g.items.map((item) => (
              // Khi đang tìm, mở sẵn các câu khớp (key đổi theo từ khóa để mở lại).
              <FaqItem key={`${item.id}-${q}`} item={item} open={Boolean(q)} />
            ))}
          </div>
        </section>
      ))}

      <section className="card-subtle faq-cta">
        <div className="stack" style={{ gap: 'var(--space-1)' }}>
          <h2>Chưa tìm thấy câu trả lời?</h2>
          <p className="muted">
            Hỏi Trợ lý An Tâm hoặc gọi hotline <a href={`tel:${CLINIC.hotlineTel}`}>{CLINIC.hotline}</a> trong giờ làm việc.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => openChat(q ? query.trim() : undefined)}>
          <Icon name="chat" /> Hỏi trợ lý
        </button>
      </section>
    </div>
  );
}
