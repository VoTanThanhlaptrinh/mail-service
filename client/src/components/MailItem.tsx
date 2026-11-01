import type { Mail } from '../types';
import { StatusBadge } from './StatusBadge';

interface MailItemProps {
  mail: Mail;
  busy: boolean;
  onSend: (id: string) => void;
  onDelete: (id: string) => void;
}

const dateFormatter = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'short',
  timeStyle: 'short',
});

export function MailItem({ mail, busy, onSend, onDelete }: MailItemProps) {
  return (
    <li className="mail">
      <div className="mail__head">
        <span className="mail__to">{mail.to}</span>
        <StatusBadge status={mail.status} />
      </div>

      <h3 className="mail__subject">{mail.subject}</h3>
      <p className="mail__body">{mail.body}</p>

      {mail.error ? <p className="mail__error">⚠ {mail.error}</p> : null}

      <div className="mail__foot">
        <time className="mail__time" dateTime={mail.createdAt}>
          {dateFormatter.format(new Date(mail.createdAt))}
        </time>

        <div className="mail__actions">
          {mail.status !== 'SENT' ? (
            <button className="button button--ghost" type="button" disabled={busy} onClick={() => onSend(mail.id)}>
              Gửi
            </button>
          ) : null}
          <button className="button button--danger" type="button" disabled={busy} onClick={() => onDelete(mail.id)}>
            Xoá
          </button>
        </div>
      </div>
    </li>
  );
}
