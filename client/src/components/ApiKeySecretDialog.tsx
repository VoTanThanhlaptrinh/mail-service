import { useState } from 'react';
import { formatDateTime } from '../format';
import type { CreatedApiKey } from '../types';
import { Modal } from './Modal';

interface ApiKeySecretDialogProps {
  mode: 'create' | 'rotate';
  apiKey: CreatedApiKey;
  onClose: () => void;
}

export function ApiKeySecretDialog({ mode, apiKey, onClose }: ApiKeySecretDialogProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(apiKey.key);
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
  }

  return (
    <Modal
      title={mode === 'create' ? 'Đã tạo API key' : 'Đã tạo secret mới'}
      subtitle={apiKey.name}
      onClose={onClose}
      footer={
        <button className="button button--primary" type="button" onClick={onClose}>
          Tôi đã lưu secret
        </button>
      }
    >
      <div className="callout callout--warning">
        <strong>Secret chỉ hiển thị một lần.</strong> Hãy copy và lưu vào nơi an toàn ngay bây giờ —
        hệ thống chỉ lưu SHA-256 hash và không thể khôi phục secret này.
      </div>

      <div className="secret">
        <code className="secret__value">{apiKey.key}</code>
        <button className="button button--ghost" type="button" onClick={() => void handleCopy()}>
          {copyState === 'copied' ? 'Đã copy' : 'Copy'}
        </button>
      </div>

      {copyState === 'error' ? (
        <p className="hint hint--error">
          Trình duyệt không cho phép copy tự động — hãy bôi đen secret ở trên và copy thủ công.
        </p>
      ) : null}

      <dl className="meta-grid">
        <div>
          <dt>Tiền tố</dt>
          <dd>
            <code>{apiKey.prefix}</code>
          </dd>
        </div>
        <div>
          <dt>Phạm vi</dt>
          <dd>{apiKey.scopes.join(', ')}</dd>
        </div>
        <div>
          <dt>Hết hạn</dt>
          <dd>{apiKey.expiresAt ? formatDateTime(apiKey.expiresAt) : 'Không hết hạn'}</dd>
        </div>
      </dl>

      {mode === 'rotate' ? (
        <div className="callout callout--danger">
          Secret cũ đã mất hiệu lực ngay lập tức. Hãy cập nhật nơi đang dùng key trước khi secret cũ bị
          gọi lại.
        </div>
      ) : null}

      <div>
        <p className="field__label">Gửi mail bằng key này</p>
        <pre className="code-block">{`curl -X POST http://localhost:4000/api/mails/<mail-id>/send \\
  -H "Authorization: Bearer ${apiKey.key}"`}</pre>
      </div>

      {apiKey.keyNotice ? <p className="hint">{apiKey.keyNotice}</p> : null}
    </Modal>
  );
}
