import { useState } from 'react';
import type { FormEvent } from 'react';
import { fromDateTimeLocal, toDateTimeLocal } from '../format';
import type { ApiKey, ApiKeyFormValues } from '../types';
import { Modal } from './Modal';

interface ApiKeyFormDialogProps {
  mode: 'create' | 'edit';
  apiKey?: ApiKey;
  busy: boolean;
  error: string | null;
  onSubmit: (values: ApiKeyFormValues) => void;
  onClose: () => void;
}

const NAME_MAX = 120;
const DESCRIPTION_MAX = 500;

export function ApiKeyFormDialog({
  mode,
  apiKey,
  busy,
  error,
  onSubmit,
  onClose,
}: ApiKeyFormDialogProps) {
  const [name, setName] = useState(apiKey?.name ?? '');
  const [description, setDescription] = useState(apiKey?.description ?? '');
  const [expiresAt, setExpiresAt] = useState(toDateTimeLocal(apiKey?.expiresAt));
  const [localError, setLocalError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedDescription = description.trim();

    if (!trimmedName) {
      setLocalError('Tên key là bắt buộc');
      return;
    }
    if (trimmedName.length > NAME_MAX) {
      setLocalError(`Tên key tối đa ${NAME_MAX} ký tự`);
      return;
    }
    if (trimmedDescription.length > DESCRIPTION_MAX) {
      setLocalError(`Mô tả tối đa ${DESCRIPTION_MAX} ký tự`);
      return;
    }

    const isoExpiry = fromDateTimeLocal(expiresAt);
    if (expiresAt && !isoExpiry) {
      setLocalError('Thời điểm hết hạn không hợp lệ');
      return;
    }
    if (isoExpiry && new Date(isoExpiry).getTime() <= Date.now()) {
      setLocalError('Thời điểm hết hạn phải ở tương lai');
      return;
    }

    setLocalError(null);
    onSubmit({
      name: trimmedName,
      description: trimmedDescription || null,
      expiresAt: isoExpiry,
    });
  }

  const message = localError ?? error;

  return (
    <Modal
      title={mode === 'create' ? 'Tạo API key' : 'Sửa API key'}
      subtitle={
        mode === 'create'
          ? 'Secret sẽ được sinh tự động và chỉ hiển thị một lần.'
          : apiKey?.prefix
      }
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button className="button button--ghost" type="button" onClick={onClose} disabled={busy}>
            Huỷ
          </button>
          <button
            className="button button--primary"
            type="submit"
            form="api-key-form"
            disabled={busy}
          >
            {busy ? 'Đang lưu…' : mode === 'create' ? 'Tạo key' : 'Lưu thay đổi'}
          </button>
        </>
      }
    >
      <form id="api-key-form" className="form form--dialog" onSubmit={handleSubmit} noValidate>
        {message ? (
          <div className="alert" role="alert">
            <span>{message}</span>
          </div>
        ) : null}

        <label className="field">
          <span className="field__label">Tên key</span>
          <input
            className="input"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Website liên hệ"
            maxLength={NAME_MAX}
            autoFocus
            required
          />
          <span className="hint">Tên gợi nhớ để nhận diện key trong danh sách.</span>
        </label>

        <label className="field">
          <span className="field__label">Mô tả</span>
          <textarea
            className="input input--textarea"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Key dùng cho form liên hệ trên website…"
            maxLength={DESCRIPTION_MAX}
            rows={3}
          />
        </label>

        <label className="field">
          <span className="field__label">Hết hạn</span>
          <input
            className="input"
            type="datetime-local"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
          />
          <span className="hint">Để trống nếu key không hết hạn. Chỉ nhận thời điểm trong tương lai.</span>
        </label>

        <div className="field">
          <span className="field__label">Phạm vi</span>
          <p className="scope">
            <code>mail:send</code>
            <span className="hint"> — gửi mail qua API key</span>
          </p>
        </div>
      </form>
    </Modal>
  );
}
