import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { CreateMailInput } from '../types';

interface MailFormProps {
  onCreate: (input: CreateMailInput) => Promise<void>;
  onSendNow: (input: CreateMailInput) => Promise<void>;
  busy: boolean;
}

export function MailForm({ onCreate, onSendNow, busy }: MailFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  async function submitWith(action: (input: CreateMailInput) => Promise<void>) {
    const payload = { to: to.trim(), subject: subject.trim(), body: body.trim() };
    if (!payload.to || !payload.subject || !payload.body) {
      return;
    }

    try {
      await action(payload);
      setTo('');
      setSubject('');
      setBody('');
    } catch {
      // The parent already surfaced the error; keep the form values for a retry.
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitWith(onSendNow);
  }

  return (
    <form ref={formRef} className="card form" onSubmit={handleSubmit}>
      <h2 className="card__title">Soạn mail mới</h2>

      <label className="field">
        <span className="field__label">Người nhận</span>
        <input
          className="input"
          type="email"
          value={to}
          onChange={(event) => setTo(event.target.value)}
          placeholder="nguoi.nhan@example.com"
          required
        />
      </label>

      <label className="field">
        <span className="field__label">Tiêu đề</span>
        <input
          className="input"
          type="text"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          placeholder="Tiêu đề email"
          maxLength={200}
          required
        />
      </label>

      <label className="field">
        <span className="field__label">Nội dung</span>
        <textarea
          className="input input--textarea"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Nội dung email…"
          rows={5}
          required
        />
      </label>

      <div className="form__actions">
        <button className="button button--primary" type="submit" disabled={busy}>
          {busy ? 'Đang xử lý…' : 'Gửi ngay'}
        </button>
        <button
          className="button button--ghost"
          type="button"
          disabled={busy}
          onClick={() => {
            if (!formRef.current?.reportValidity()) return;
            void submitWith(onCreate);
          }}
        >
          {busy ? 'Đang lưu…' : 'Thêm vào hàng đợi'}
        </button>
      </div>
    </form>
  );
}
