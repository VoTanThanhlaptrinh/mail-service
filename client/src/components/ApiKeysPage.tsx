import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { formatDate, formatDateTime, isPast } from '../format';
import type {
  ApiKey,
  ApiKeyFormValues,
  ApiKeyStatus,
  CreatedApiKey,
} from '../types';
import { ApiKeyFormDialog } from './ApiKeyFormDialog';
import { ApiKeyDetailDialog } from './ApiKeyDetailDialog';
import { ApiKeySecretDialog } from './ApiKeySecretDialog';
import { ApiKeyStatusBadge } from './ApiKeyBadges';
import { ConfirmDialog } from './ConfirmDialog';

const PAGE_SIZE = 50;

type StatusFilter = ApiKeyStatus | 'ALL';

type ActionKind = 'rotate' | 'revoke' | 'delete';

type FormState = { mode: 'create' } | { mode: 'edit'; apiKey: ApiKey };

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'ALL', label: 'Tất cả' },
  { value: 'ACTIVE', label: 'Đang hoạt động' },
  { value: 'REVOKED', label: 'Đã thu hồi' },
];

const ACTIONS: Record<
  ActionKind,
  { title: string; confirmLabel: string; danger: boolean; message: (name: string) => string }
> = {
  rotate: {
    title: 'Tạo secret mới?',
    confirmLabel: 'Tạo secret mới',
    danger: false,
    message: (name) =>
      `Secret hiện tại của "${name}" sẽ mất hiệu lực ngay lập tức. Secret mới chỉ hiển thị một lần sau khi tạo.`,
  },
  revoke: {
    title: 'Thu hồi API key?',
    confirmLabel: 'Thu hồi',
    danger: true,
    message: (name) =>
      `Mọi request dùng key "${name}" sẽ bị từ chối (401). Lịch sử sử dụng và audit trail vẫn được giữ lại.`,
  },
  delete: {
    title: 'Xoá API key?',
    confirmLabel: 'Xoá key',
    danger: true,
    message: (name) =>
      `Key "${name}" sẽ bị thu hồi và ẩn khỏi danh sách (xoá mềm). Audit trail và lịch sử sử dụng vẫn được giữ.`,
  },
};

function describeError(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

function expiryLabel(apiKey: ApiKey): string {
  if (!apiKey.expiresAt) return 'Không hết hạn';
  return `${formatDate(apiKey.expiresAt)}${isPast(apiKey.expiresAt) ? ' · đã hết hạn' : ''}`;
}

interface ApiKeysPageProps {
  notify: (tone: 'error' | 'success', message: string) => void;
}

export function ApiKeysPage({ notify }: ApiKeysPageProps) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  const [form, setForm] = useState<FormState | null>(null);
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [secret, setSecret] = useState<{ mode: 'create' | 'rotate'; apiKey: CreatedApiKey } | null>(
    null,
  );
  const [detailKey, setDetailKey] = useState<ApiKey | null>(null);
  const [confirm, setConfirm] = useState<{ kind: ActionKind; apiKey: ApiKey } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const loadKeys = useCallback(
    async (offset = 0, append = false) => {
      if (append) setMoreLoading(true);
      else setLoading(true);

      try {
        const data = await api.listApiKeys({
          status: status === 'ALL' ? undefined : status,
          search: search || undefined,
          limit: PAGE_SIZE,
          offset,
        });

        setKeys((previous) => (append ? [...previous, ...data.items] : data.items));
        setTotal(data.total);
        setListError(null);
      } catch (cause) {
        setListError(describeError(cause, 'Không tải được danh sách API key'));
      } finally {
        if (append) setMoreLoading(false);
        else setLoading(false);
      }
    },
    [status, search],
  );

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  function openCreate() {
    setFormError(null);
    setForm({ mode: 'create' });
  }

  function openEdit(apiKey: ApiKey) {
    setFormError(null);
    setForm({ mode: 'edit', apiKey });
  }

  async function handleFormSubmit(values: ApiKeyFormValues) {
    setFormBusy(true);
    setFormError(null);

    try {
      if (form?.mode === 'edit') {
        const updated = await api.updateApiKey(form.apiKey.id, {
          name: values.name,
          description: values.description,
          expiresAt: values.expiresAt,
        });
        setForm(null);
        notify('success', `Đã cập nhật API key "${updated.name}".`);
      } else {
        const created = await api.createApiKey({
          name: values.name,
          description: values.description,
          expiresAt: values.expiresAt,
        });
        setForm(null);
        setSecret({ mode: 'create', apiKey: created });
        notify('success', `Đã tạo API key "${created.name}".`);
      }

      await loadKeys();
    } catch (cause) {
      setFormError(describeError(cause, 'Không lưu được API key'));
    } finally {
      setFormBusy(false);
    }
  }

  async function runConfirmedAction() {
    if (!confirm) return;

    const { kind, apiKey } = confirm;
    setActionBusy(true);

    try {
      if (kind === 'rotate') {
        const rotated = await api.rotateApiKey(apiKey.id);
        setSecret({ mode: 'rotate', apiKey: rotated });
        notify('success', `Đã tạo secret mới cho API key "${apiKey.name}".`);
      } else if (kind === 'revoke') {
        await api.revokeApiKey(apiKey.id);
        notify('success', `Đã thu hồi API key "${apiKey.name}".`);
      } else {
        await api.deleteApiKey(apiKey.id);
        notify('success', `Đã xoá API key "${apiKey.name}".`);
      }

      setConfirm(null);
      setDetailKey((current) => (current?.id === apiKey.id ? null : current));
      await loadKeys();
    } catch (cause) {
      setConfirm(null);
      notify('error', describeError(cause, 'Thao tác thất bại'));
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <section className="card keys">
      <div className="list__toolbar">
        <h2 className="card__title">
          API key <span className="count">{total}</span>
        </h2>
        <button className="button button--primary" type="button" onClick={openCreate}>
          + Tạo key
        </button>
      </div>

      <p className="keys__hint">
        Secret chỉ hiển thị một lần khi tạo hoặc rotate; hệ thống chỉ lưu SHA-256 hash. Dùng{' '}
        <code>Authorization: Bearer &lt;key&gt;</code> khi gọi API gửi mail.
      </p>

      <div className="list__toolbar">
        <div className="filters">
          {FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              className={`chip ${status === filter.value ? 'chip--active' : ''}`}
              onClick={() => setStatus(filter.value)}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <div className="search search--grow">
          <input
            className="input"
            type="search"
            placeholder="Tìm theo tên hoặc tiền tố…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
          <button
            className="button button--ghost"
            type="button"
            onClick={() => void loadKeys()}
            disabled={loading}
          >
            {loading ? 'Đang tải…' : 'Làm mới'}
          </button>
        </div>
      </div>

      {listError ? (
        <div className="alert" role="alert">
          <span>{listError}</span>
        </div>
      ) : null}

      {loading && keys.length === 0 ? (
        <p className="empty">Đang tải danh sách API key…</p>
      ) : keys.length === 0 ? (
        <div className="empty">
          <p>
            {search || status !== 'ALL'
              ? 'Không có API key nào khớp bộ lọc.'
              : 'Chưa có API key nào. Tạo key đầu tiên để gọi API gửi mail.'}
          </p>
          {!search && status === 'ALL' ? (
            <button
              className="button button--primary empty__action"
              type="button"
              onClick={openCreate}
            >
              Tạo key đầu tiên
            </button>
          ) : null}
        </div>
      ) : (
        <ul className="key-list">
          {keys.map((apiKey) => (
            <li
              className={`key-card ${apiKey.status === 'REVOKED' ? 'key-card--revoked' : ''}`}
              key={apiKey.id}
            >
              <div className="key-card__head">
                <div className="key-card__identity">
                  <h3 className="key-card__name">{apiKey.name}</h3>
                  <code className="key-card__prefix">{apiKey.prefix}</code>
                </div>
                <ApiKeyStatusBadge status={apiKey.status} />
              </div>

              {apiKey.description ? <p className="key-card__desc">{apiKey.description}</p> : null}

              <div className="key-card__meta">
                <span>
                  <strong>Phạm vi:</strong> {apiKey.scopes.join(', ')}
                </span>
                <span>
                  <strong>Hết hạn:</strong> {expiryLabel(apiKey)}
                </span>
                <span>
                  <strong>Dùng gần nhất:</strong> {formatDateTime(apiKey.lastUsedAt)}
                </span>
                <span>
                  <strong>Tạo:</strong> {formatDateTime(apiKey.createdAt)} · {apiKey.createdBy}
                </span>
              </div>

              {apiKey.status === 'REVOKED' ? (
                <p className="key-card__revoked">
                  Thu hồi {formatDateTime(apiKey.revokedAt)}
                  {apiKey.revokedReason ? ` · ${apiKey.revokedReason}` : ''}
                </p>
              ) : null}

              <div className="key-card__actions">
                <button
                  className="button button--ghost"
                  type="button"
                  onClick={() => setDetailKey(apiKey)}
                >
                  Lịch sử
                </button>
                <button className="button button--ghost" type="button" onClick={() => openEdit(apiKey)}>
                  Sửa
                </button>
                {apiKey.status === 'ACTIVE' ? (
                  <>
                    <button
                      className="button button--ghost"
                      type="button"
                      onClick={() => setConfirm({ kind: 'rotate', apiKey })}
                    >
                      Secret mới
                    </button>
                    <button
                      className="button button--danger"
                      type="button"
                      onClick={() => setConfirm({ kind: 'revoke', apiKey })}
                    >
                      Thu hồi
                    </button>
                  </>
                ) : null}
                <button
                  className="button button--danger"
                  type="button"
                  onClick={() => setConfirm({ kind: 'delete', apiKey })}
                >
                  Xoá
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {keys.length < total ? (
        <div className="load-more">
          <button
            className="button button--ghost"
            type="button"
            onClick={() => void loadKeys(keys.length, true)}
            disabled={moreLoading}
          >
            {moreLoading ? 'Đang tải…' : `Tải thêm (${keys.length}/${total})`}
          </button>
        </div>
      ) : null}

      {form ? (
        <ApiKeyFormDialog
          mode={form.mode}
          apiKey={form.mode === 'edit' ? form.apiKey : undefined}
          busy={formBusy}
          error={formError}
          onSubmit={(values) => void handleFormSubmit(values)}
          onClose={() => setForm(null)}
        />
      ) : null}

      {secret ? (
        <ApiKeySecretDialog
          mode={secret.mode}
          apiKey={secret.apiKey}
          onClose={() => setSecret(null)}
        />
      ) : null}

      {detailKey ? (
        <ApiKeyDetailDialog apiKey={detailKey} onClose={() => setDetailKey(null)} />
      ) : null}

      {confirm ? (
        <ConfirmDialog
          title={ACTIONS[confirm.kind].title}
          message={ACTIONS[confirm.kind].message(confirm.apiKey.name)}
          confirmLabel={ACTIONS[confirm.kind].confirmLabel}
          danger={ACTIONS[confirm.kind].danger}
          busy={actionBusy}
          onConfirm={() => void runConfirmedAction()}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
    </section>
  );
}
