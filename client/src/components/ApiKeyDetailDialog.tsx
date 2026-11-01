import { useEffect, useState } from 'react';
import { api } from '../api';
import { formatDateTime, formatDuration, isPast } from '../format';
import type { ApiKey, AuditLog, UsageLog, UsageOutcome } from '../types';
import { ApiKeyStatusBadge, AuditActionTag, UsageOutcomeBadge } from './ApiKeyBadges';
import { Modal } from './Modal';

const PAGE_SIZE = 20;

const OUTCOME_FILTERS: { value: UsageOutcome | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'Tất cả' },
  { value: 'SUCCESS', label: 'Thành công' },
  { value: 'FAILED', label: 'Thất bại' },
  { value: 'REJECTED', label: 'Bị chặn' },
];

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

interface ApiKeyDetailDialogProps {
  apiKey: ApiKey;
  onClose: () => void;
}

export function ApiKeyDetailDialog({ apiKey, onClose }: ApiKeyDetailDialogProps) {
  const [outcome, setOutcome] = useState<UsageOutcome | 'ALL'>('ALL');
  const [usage, setUsage] = useState<UsageLog[]>([]);
  const [usageTotal, setUsageTotal] = useState(0);
  const [usageLoading, setUsageLoading] = useState(true);
  const [usageMore, setUsageMore] = useState(false);
  const [usageError, setUsageError] = useState<string | null>(null);

  const [audit, setAudit] = useState<AuditLog[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditError, setAuditError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setUsageLoading(true);

    api
      .listApiKeyUsage(apiKey.id, {
        outcome: outcome === 'ALL' ? undefined : outcome,
        limit: PAGE_SIZE,
        offset: 0,
      })
      .then((data) => {
        if (cancelled) return;
        setUsage(data.items);
        setUsageTotal(data.total);
        setUsageError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setUsageError(errorMessage(cause, 'Không tải được lịch sử gọi mail'));
      })
      .finally(() => {
        if (!cancelled) setUsageLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [apiKey.id, outcome]);

  useEffect(() => {
    let cancelled = false;

    api
      .listAuditLogs({ entity: 'api_key', entityId: apiKey.id, limit: 50 })
      .then((data) => {
        if (cancelled) return;
        setAudit(data.items);
        setAuditTotal(data.total);
        setAuditError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setAuditError(errorMessage(cause, 'Không tải được audit trail'));
      })
      .finally(() => {
        if (!cancelled) setAuditLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [apiKey.id]);

  async function loadMoreUsage() {
    setUsageMore(true);
    try {
      const data = await api.listApiKeyUsage(apiKey.id, {
        outcome: outcome === 'ALL' ? undefined : outcome,
        limit: PAGE_SIZE,
        offset: usage.length,
      });
      setUsage((previous) => [...previous, ...data.items]);
      setUsageTotal(data.total);
    } catch (cause) {
      setUsageError(errorMessage(cause, 'Không tải thêm được lịch sử'));
    } finally {
      setUsageMore(false);
    }
  }

  const expiresLabel = apiKey.expiresAt
    ? `${formatDateTime(apiKey.expiresAt)}${isPast(apiKey.expiresAt) ? ' · đã hết hạn' : ''}`
    : 'Không hết hạn';

  return (
    <Modal
      title={apiKey.name}
      subtitle={<code>{apiKey.prefix}</code>}
      size="lg"
      onClose={onClose}
      footer={
        <button className="button button--ghost" type="button" onClick={onClose}>
          Đóng
        </button>
      }
    >
      <dl className="meta-grid">
        <div>
          <dt>Trạng thái</dt>
          <dd>
            <ApiKeyStatusBadge status={apiKey.status} />
          </dd>
        </div>
        <div>
          <dt>Phạm vi</dt>
          <dd>{apiKey.scopes.join(', ')}</dd>
        </div>
        <div>
          <dt>Hết hạn</dt>
          <dd>{expiresLabel}</dd>
        </div>
        <div>
          <dt>Dùng gần nhất</dt>
          <dd>{formatDateTime(apiKey.lastUsedAt)}</dd>
        </div>
        <div>
          <dt>Tạo</dt>
          <dd>
            {formatDateTime(apiKey.createdAt)} · {apiKey.createdBy}
          </dd>
        </div>
        <div>
          <dt>Cập nhật</dt>
          <dd>
            {formatDateTime(apiKey.updatedAt)} · {apiKey.updatedBy}
          </dd>
        </div>
        {apiKey.revokedAt ? (
          <div>
            <dt>Thu hồi</dt>
            <dd>
              {formatDateTime(apiKey.revokedAt)}
              {apiKey.revokedReason ? ` · ${apiKey.revokedReason}` : ''}
            </dd>
          </div>
        ) : null}
      </dl>

      <section className="section">
        <div className="section__head">
          <h3 className="section__title">
            Lịch sử gọi mail <span className="count">{usageTotal}</span>
          </h3>
          <div className="filters">
            {OUTCOME_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                className={`chip ${outcome === filter.value ? 'chip--active' : ''}`}
                onClick={() => setOutcome(filter.value)}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        {usageLoading ? (
          <p className="empty">Đang tải lịch sử…</p>
        ) : usageError ? (
          <div className="alert" role="alert">
            <span>{usageError}</span>
          </div>
        ) : usage.length === 0 ? (
          <p className="empty">
            {outcome === 'ALL'
              ? 'Key này chưa được dùng để gửi mail lần nào.'
              : 'Không có lượt gọi nào khớp bộ lọc.'}
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Thời điểm</th>
                  <th>Kết quả</th>
                  <th>Request</th>
                  <th>HTTP</th>
                  <th>Thời lượng</th>
                  <th>Lỗi</th>
                </tr>
              </thead>
              <tbody>
                {usage.map((log) => (
                  <tr key={log.id}>
                    <td className="table__nowrap">{formatDateTime(log.createdAt)}</td>
                    <td>
                      <UsageOutcomeBadge outcome={log.outcome} />
                    </td>
                    <td>
                      <code>
                        {log.httpMethod} {log.path}
                      </code>
                      {log.requestId ? (
                        <div className="table__muted">req: {log.requestId}</div>
                      ) : null}
                    </td>
                    <td className="table__nowrap">{log.statusCode ?? '—'}</td>
                    <td className="table__nowrap">{formatDuration(log.durationMs)}</td>
                    <td>
                      {log.errorCode ? (
                        <span className="table__error" title={log.errorMessage ?? undefined}>
                          {log.errorCode}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {usage.length < usageTotal ? (
          <div className="load-more">
            <button
              className="button button--ghost"
              type="button"
              onClick={() => void loadMoreUsage()}
              disabled={usageMore}
            >
              {usageMore ? 'Đang tải…' : `Tải thêm (${usage.length}/${usageTotal})`}
            </button>
          </div>
        ) : null}
      </section>

      <section className="section">
        <div className="section__head">
          <h3 className="section__title">
            Audit trail <span className="count">{auditTotal}</span>
          </h3>
        </div>

        {auditLoading ? (
          <p className="empty">Đang tải audit…</p>
        ) : auditError ? (
          <div className="alert" role="alert">
            <span>{auditError}</span>
          </div>
        ) : audit.length === 0 ? (
          <p className="empty">Chưa có bản ghi audit nào.</p>
        ) : (
          <ul className="timeline">
            {audit.map((entry) => (
              <li className="timeline__item" key={entry.id}>
                <AuditActionTag action={entry.action} />
                <span className="timeline__actor">{entry.actor}</span>
                {entry.requestId ? (
                  <code className="timeline__request">req: {entry.requestId}</code>
                ) : null}
                <time className="timeline__time" dateTime={entry.occurredAt}>
                  {formatDateTime(entry.occurredAt)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Modal>
  );
}
