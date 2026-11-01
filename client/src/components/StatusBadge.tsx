import type { MailStatus } from '../types';

const LABELS: Record<MailStatus, string> = {
  QUEUED: 'Đang chờ',
  SENT: 'Đã gửi',
  FAILED: 'Thất bại',
};

export function StatusBadge({ status }: { status: MailStatus }) {
  return <span className={`badge badge--${status.toLowerCase()}`}>{LABELS[status]}</span>;
}
