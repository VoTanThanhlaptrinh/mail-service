import type { ApiKeyStatus, AuditAction, UsageOutcome } from '../types';

const KEY_LABELS: Record<ApiKeyStatus, string> = {
  ACTIVE: 'Đang hoạt động',
  REVOKED: 'Đã thu hồi',
};

export function ApiKeyStatusBadge({ status }: { status: ApiKeyStatus }) {
  return <span className={`badge badge--key-${status.toLowerCase()}`}>{KEY_LABELS[status]}</span>;
}

const OUTCOME_LABELS: Record<UsageOutcome, string> = {
  SUCCESS: 'Thành công',
  FAILED: 'Thất bại',
  REJECTED: 'Bị chặn',
};

export function UsageOutcomeBadge({ outcome }: { outcome: UsageOutcome }) {
  return <span className={`badge badge--${outcome.toLowerCase()}`}>{OUTCOME_LABELS[outcome]}</span>;
}

const ACTION_LABELS: Record<AuditAction, string> = {
  CREATE: 'Tạo',
  UPDATE: 'Cập nhật',
  REVOKE: 'Thu hồi',
  ROTATE: 'Tạo secret mới',
  DELETE: 'Xoá',
};

export function AuditActionTag({ action }: { action: AuditAction }) {
  return <span className={`tag tag--${action.toLowerCase()}`}>{ACTION_LABELS[action] ?? action}</span>;
}
