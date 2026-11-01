import type { ReactNode } from 'react';
import { Modal } from './Modal';

interface ConfirmDialogProps {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  busy = false,
  danger = true,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      title={title}
      onClose={busy ? () => undefined : onCancel}
      footer={
        <>
          <button className="button button--ghost" type="button" onClick={onCancel} disabled={busy}>
            Huỷ
          </button>
          <button
            className={`button ${danger ? 'button--solid-danger' : 'button--primary'}`}
            type="button"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Đang xử lý…' : confirmLabel}
          </button>
        </>
      }
    >
      <div className="confirm__message">{message}</div>
    </Modal>
  );
}
