import { formatMoney } from '../../lib/time';
import type { PendingAction } from '../../lib/types';

export type CardStatus = 'idle' | 'busy' | 'done' | 'rejected' | 'error' | 'stale';

export interface CardState {
  action: PendingAction;
  status: CardStatus;
  note?: string;
}

const RESULT_TEXT: Partial<Record<CardStatus, string>> = {
  done: 'Đã xác nhận',
  rejected: 'Đã hủy đề xuất',
  stale: 'Đề xuất này đã được thay bằng đề xuất mới',
};

/** Thẻ xác nhận thao tác ghi: tên bác sĩ, ngày giờ, lý do, hai nút Đồng ý và Hủy. */
export function ConfirmationCard({ card, onConfirm, onReject }: { card: CardState; onConfirm: () => void; onReject: () => void }) {
  const { summary, type } = card.action;
  const locked = card.status !== 'idle';
  const confirmLabel = type === 'CANCEL' ? 'Đồng ý hủy lịch' : 'Đồng ý';
  return (
    <section className="confirm-card" aria-label={summary.title}>
      <strong>{summary.title}</strong>
      <dl className="summary small">
        <dt>Bác sĩ</dt>
        <dd>
          {summary.doctorName} · {summary.specialtyName}
        </dd>
        {summary.oldStartTimeText && (
          <>
            <dt>Giờ cũ</dt>
            <dd>{summary.oldStartTimeText}</dd>
          </>
        )}
        <dt>{type === 'RESCHEDULE' ? 'Giờ mới' : 'Thời gian'}</dt>
        <dd>{summary.startTimeText}</dd>
        {summary.changeReason && (
          <>
            <dt>{type === 'CANCEL' ? 'Lý do hủy' : 'Lý do đổi'}</dt>
            <dd>{summary.changeReason}</dd>
          </>
        )}
        <dt>Lý do khám</dt>
        <dd>{summary.reason}</dd>
        {summary.fee !== undefined && (
          <>
            <dt>Phí khám</dt>
            <dd>{formatMoney(summary.fee)}</dd>
          </>
        )}
      </dl>
      <div className="row">
        <button type="button" className={type === 'CANCEL' ? 'btn btn-danger-solid btn-sm' : 'btn btn-primary btn-sm'} disabled={locked} onClick={onConfirm}>
          {card.status === 'busy' ? 'Đang xử lý…' : confirmLabel}
        </button>
        <button type="button" className="btn btn-sm" disabled={locked} onClick={onReject}>
          Hủy
        </button>
      </div>
      {card.status === 'idle' && (
        <span className="caption">
          {type === 'RESCHEDULE'
            ? 'Bấm Đồng ý để gửi yêu cầu đổi lịch; lịch chỉ chuyển sang giờ mới khi phòng khám xác nhận. Đề xuất hết hạn sau 10 phút.'
            : `Lịch chỉ được ghi khi bạn bấm ${confirmLabel}. Đề xuất hết hạn sau 10 phút.`}
        </span>
      )}
      {RESULT_TEXT[card.status] && (
        <span className={card.status === 'done' ? 'small confirm-ok' : 'caption'} role="status">
          {card.status === 'done' && '✓ '}
          {card.status === 'done' && type === 'RESCHEDULE' ? 'Đã gửi yêu cầu, chờ phòng khám xác nhận' : RESULT_TEXT[card.status]}
        </span>
      )}
      {card.status === 'error' && (
        <span className="small confirm-error" role="alert">
          {card.note}
        </span>
      )}
    </section>
  );
}
