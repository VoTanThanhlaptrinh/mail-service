import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { BulkCreateMailInput, BulkRecipientInput, CreateMailInput } from '../types';

interface MailFormProps {
  onCreate: (input: CreateMailInput) => Promise<void>;
  onSendNow: (input: CreateMailInput) => Promise<void>;
  onBulkSubmit?: (input: BulkCreateMailInput) => Promise<void>;
  busy: boolean;
}

interface RecipientRow {
  to: string;
  variables: Record<string, string>;
}

function extractVariables(text: string): string[] {
  if (!text) return [];
  const regex = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  const matches = text.matchAll(regex);
  const vars: string[] = [];
  for (const m of matches) {
    const key = m[1];
    if (key && !vars.includes(key)) {
      vars.push(key);
    }
  }
  return vars;
}

function renderPreview(text: string, vars: Record<string, string>): string {
  if (!text) return '';
  const regex = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  return text.replace(regex, (_, key: string) => {
    const val = vars[key];
    if (val !== undefined && val !== null && val.trim() !== '') {
      return val.trim();
    }
    return `{{${key}}}`;
  });
}

export function MailForm({ onCreate, onSendNow, onBulkSubmit, busy }: MailFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [mode, setMode] = useState<'single' | 'bulk'>('single');

  // Single mail state
  const [to, setTo] = useState('');

  // Common template fields
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  // Bulk mail state
  const [recipients, setRecipients] = useState<RecipientRow[]>([
    { to: '', variables: {} },
  ]);
  const [previewIndex, setPreviewIndex] = useState(0);

  const detectedVariables = Array.from(
    new Set([...extractVariables(subject), ...extractVariables(body)]),
  );

  async function submitSingleWith(action: (input: CreateMailInput) => Promise<void>) {
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

  async function submitBulkWith(sendNow: boolean) {
    if (!onBulkSubmit) return;
    if (!formRef.current?.reportValidity()) return;

    const trimmedSubject = subject.trim();
    const trimmedBody = body.trim();
    if (!trimmedSubject || !trimmedBody) return;

    const cleanRecipients: BulkRecipientInput[] = recipients.map((r) => ({
      to: r.to.trim(),
      variables: Object.fromEntries(
        detectedVariables.map((v) => [v, (r.variables[v] ?? '').trim()]),
      ),
    }));

    try {
      await onBulkSubmit({
        subject: trimmedSubject,
        body: trimmedBody,
        recipients: cleanRecipients,
        sendNow,
      });
      setSubject('');
      setBody('');
      setRecipients([{ to: '', variables: {} }]);
      setPreviewIndex(0);
    } catch {
      // The parent already surfaced the error; keep the form values for a retry.
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === 'single') {
      await submitSingleWith(onSendNow);
      return;
    }
    await submitBulkWith(true);
  }

  function addRecipient() {
    if (recipients.length >= 100) return;
    setRecipients((prev) => [...prev, { to: '', variables: {} }]);
  }

  function removeRecipient(index: number) {
    if (recipients.length <= 1) return;
    setRecipients((prev) => prev.filter((_, i) => i !== index));
    if (previewIndex >= recipients.length - 1) {
      setPreviewIndex(Math.max(0, recipients.length - 2));
    }
  }

  function updateRecipientTo(index: number, value: string) {
    setRecipients((prev) =>
      prev.map((r, i) => (i === index ? { ...r, to: value } : r)),
    );
  }

  function updateRecipientVariable(index: number, key: string, value: string) {
    setRecipients((prev) =>
      prev.map((r, i) =>
        i === index
          ? { ...r, variables: { ...r.variables, [key]: value } }
          : r,
      ),
    );
  }

  const activeRecipient = recipients[previewIndex] ?? recipients[0];
  const previewSubject = activeRecipient
    ? renderPreview(subject, activeRecipient.variables)
    : subject;
  const previewBody = activeRecipient
    ? renderPreview(body, activeRecipient.variables)
    : body;

  return (
    <form ref={formRef} className="card form" onSubmit={handleSubmit}>
      <div className="form__header">
        <h2 className="card__title">{mode === 'single' ? 'Soạn mail mới' : 'Gửi mail hàng loạt'}</h2>
        <div className="mode-toggle">
          <button
            type="button"
            className={`chip ${mode === 'single' ? 'chip--active' : ''}`}
            onClick={() => setMode('single')}
          >
            Gửi đơn
          </button>
          <button
            type="button"
            className={`chip ${mode === 'bulk' ? 'chip--active' : ''}`}
            onClick={() => setMode('bulk')}
          >
            Gửi hàng loạt
          </button>
        </div>
      </div>

      {mode === 'single' ? (
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
      ) : null}

      <label className="field">
        <span className="field__label">
          Tiêu đề {mode === 'bulk' && <span className="field__hint">(hỗ trợ {`{{biến}}`})</span>}
        </span>
        <input
          className="input"
          type="text"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          placeholder={mode === 'bulk' ? 'Ví dụ: Chào mừng {{name}} gia nhập công ty' : 'Tiêu đề email'}
          maxLength={200}
          required
        />
      </label>

      <label className="field">
        <span className="field__label">
          Nội dung {mode === 'bulk' && <span className="field__hint">(hỗ trợ {`{{biến}}`})</span>}
        </span>
        <textarea
          className="input input--textarea"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={
            mode === 'bulk'
              ? 'Xin chào {{title}} {{name}}, mã nhân viên của bạn là {{code}}…'
              : 'Nội dung email…'
          }
          rows={mode === 'bulk' ? 4 : 5}
          required
        />
      </label>

      {mode === 'bulk' && (
        <>
          {detectedVariables.length > 0 && (
            <div className="detected-vars">
              <span className="field__label">Biến template nhận diện:</span>
              <div className="detected-vars__list">
                {detectedVariables.map((v) => (
                  <span key={v} className="var-tag">{`{{${v}}}`}</span>
                ))}
              </div>
            </div>
          )}

          <div className="bulk-section">
            <div className="bulk-section__header">
              <span className="field__label">Danh sách người nhận ({recipients.length}/100)</span>
              <button
                type="button"
                className="button button--ghost button--small"
                onClick={addRecipient}
                disabled={busy || recipients.length >= 100}
              >
                + Thêm người nhận
              </button>
            </div>

            <div className="bulk-recipients-list">
              {recipients.map((r, index) => (
                <div key={index} className="bulk-recipient-item">
                  <div className="bulk-recipient-item__top">
                    <span className="recipient-badge">#{index + 1}</span>
                    {recipients.length > 1 && (
                      <button
                        type="button"
                        className="button button--danger button--small"
                        onClick={() => removeRecipient(index)}
                        disabled={busy}
                        title="Xoá người nhận này"
                      >
                        Xoá
                      </button>
                    )}
                  </div>

                  <div className="bulk-recipient-item__fields">
                    <label className="field">
                      <span className="field__sublabel">Email</span>
                      <input
                        className="input input--compact"
                        type="email"
                        value={r.to}
                        onChange={(e) => updateRecipientTo(index, e.target.value)}
                        placeholder="email@example.com"
                        required
                      />
                    </label>

                    {detectedVariables.map((v) => (
                      <label key={v} className="field">
                        <span className="field__sublabel">{`{{${v}}}`}</span>
                        <input
                          className="input input--compact"
                          type="text"
                          value={r.variables[v] ?? ''}
                          onChange={(e) => updateRecipientVariable(index, v, e.target.value)}
                          placeholder={`Giá trị ${v}`}
                          required
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="preview-card">
            <div className="preview-card__header">
              <span className="field__label">Xem trước nội dung (Preview)</span>
              {recipients.length > 1 && (
                <select
                  className="preview-select"
                  value={previewIndex}
                  onChange={(e) => setPreviewIndex(Number(e.target.value))}
                >
                  {recipients.map((r, i) => (
                    <option key={i} value={i}>
                      Người nhận #{i + 1} {r.to ? `(${r.to})` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="preview-card__content">
              <div className="preview-row">
                <span className="preview-row__label">Gửi đến:</span>
                <span className="preview-row__value">{activeRecipient?.to || '(Chưa nhập email)'}</span>
              </div>
              <div className="preview-row">
                <span className="preview-row__label">Tiêu đề:</span>
                <span className="preview-row__value">{previewSubject || '(Chưa có tiêu đề)'}</span>
              </div>
              <div className="preview-row">
                <span className="preview-row__label">Nội dung:</span>
                <div className="preview-row__body">{previewBody || '(Chưa có nội dung)'}</div>
              </div>
            </div>
          </div>
        </>
      )}

      <div className="form__actions">
        <button className="button button--primary" type="submit" disabled={busy}>
          {busy ? 'Đang xử lý…' : 'Gửi ngay'}
        </button>
        <button
          className="button button--ghost"
          type="button"
          disabled={busy}
          onClick={() => {
            if (mode === 'single') {
              if (!formRef.current?.reportValidity()) return;
              void submitSingleWith(onCreate);
              return;
            }
            void submitBulkWith(false);
          }}
        >
          {busy ? 'Đang lưu…' : 'Thêm vào hàng đợi'}
        </button>
      </div>
    </form>
  );
}
