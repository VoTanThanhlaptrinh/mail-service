import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { CreateMailInput, Mail, MailStatus } from '../types';
import { MailForm } from './MailForm';
import { MailItem } from './MailItem';

type StatusFilter = MailStatus | 'ALL';

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'ALL', label: 'Tất cả' },
  { value: 'QUEUED', label: 'Đang chờ' },
  { value: 'SENT', label: 'Đã gửi' },
  { value: 'FAILED', label: 'Thất bại' },
];

interface MailboxPageProps {
  notify: (tone: 'error' | 'success', message: string) => void;
}

export function MailboxPage({ notify }: MailboxPageProps) {
  const [mails, setMails] = useState<Mail[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>('ALL');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const loadMails = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listMails({
        status: filter === 'ALL' ? undefined : filter,
        search: search || undefined,
      });
      setMails(data.items);
      setTotal(data.total);
    } catch (cause) {
      notify('error', cause instanceof Error ? cause.message : 'Không tải được danh sách mail');
    } finally {
      setLoading(false);
    }
  }, [filter, search, notify]);

  useEffect(() => {
    void loadMails();
  }, [loadMails]);

  async function handleCreate(input: CreateMailInput): Promise<void> {
    setCreating(true);
    try {
      await api.createMail(input);
      await loadMails();
    } catch (cause) {
      notify('error', cause instanceof Error ? cause.message : 'Không tạo được mail');
      throw cause;
    } finally {
      setCreating(false);
    }
  }

  async function handleSend(id: string): Promise<void> {
    setBusyId(id);
    try {
      await api.sendMail(id);
      await loadMails();
    } catch (cause) {
      notify('error', cause instanceof Error ? cause.message : 'Không gửi được mail');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string): Promise<void> {
    setBusyId(id);
    try {
      await api.deleteMail(id);
      await loadMails();
    } catch (cause) {
      notify('error', cause instanceof Error ? cause.message : 'Không xoá được mail');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="layout">
      <MailForm onCreate={handleCreate} busy={creating} />

      <section className="card list">
        <div className="list__toolbar">
          <h2 className="card__title">
            Hộp thư <span className="count">{total}</span>
          </h2>

          <div className="filters">
            {FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`chip ${filter === option.value ? 'chip--active' : ''}`}
                onClick={() => setFilter(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="search">
          <input
            className="input"
            type="search"
            placeholder="Tìm theo người nhận hoặc tiêu đề…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
          <button
            className="button button--ghost"
            type="button"
            onClick={() => void loadMails()}
            disabled={loading}
          >
            {loading ? 'Đang tải…' : 'Làm mới'}
          </button>
        </div>

        {loading && mails.length === 0 ? (
          <p className="empty">Đang tải dữ liệu…</p>
        ) : mails.length === 0 ? (
          <p className="empty">Chưa có mail nào. Hãy tạo mail đầu tiên ở khung bên trái.</p>
        ) : (
          <ul className="mails">
            {mails.map((mail) => (
              <MailItem
                key={mail.id}
                mail={mail}
                busy={busyId === mail.id}
                onSend={(id) => void handleSend(id)}
                onDelete={(id) => void handleDelete(id)}
              />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
