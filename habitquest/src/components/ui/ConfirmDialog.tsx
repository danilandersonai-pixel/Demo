import { TriangleAlert } from 'lucide-react';
import { Button } from './Button';
import { Modal } from './Modal';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, message, confirmLabel, tone = 'danger', onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      icon={<TriangleAlert size={18} className={tone === 'danger' ? 'text-rose-400' : 'text-cyan-300'} />}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Отмена
          </Button>
          <Button
            variant={tone}
            data-autofocus
            onClick={() => {
              onConfirm();
              onCancel();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-violet-100/80">{message}</p>
    </Modal>
  );
}
