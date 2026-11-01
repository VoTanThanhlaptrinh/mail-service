import { useState } from 'react';
import type { FormEvent } from 'react';
import type { CreateMailInput } from '../types';

interface MailFormProps {
  onCreate: (input: CreateMailInput) => Promise<void>;
  busy: boolean;
}

export function MailForm({ onCreate, busy }: MailFormProps) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await onCreate({ to: to.trim(), subject: subject.trim(), body: body.trim() });
      setTo('');
      setSubject('');
      setBody('');
    } catch {
      // The parent already surfaced the error; keep the form values for a retry.
    }
  }

  return (
    <form className="card form" onSubmit={handleSubmit}>
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

      <button className="button button--primary" type="submit" disabled={busy}>
        {busy ? 'Đang lưu…' : 'Thêm vào hàng đợi'}
      </button>
    </form>
  );
}
