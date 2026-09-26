import { MonitorSmartphone } from 'lucide-react';
import { Modal } from './ui/Modal.tsx';
import { NeonButton } from './ui/NeonButton.tsx';

/** Игра продолжилась в другой вкладке: эта вкладка замирает, чтобы не затереть свежий прогресс. */
export function TakeoverModal({ open, onTakeOver }: { open: boolean; onTakeOver: () => void }) {
  return (
    <Modal open={open} labelledBy="takeover-title" layer="z-[90]">
      <div className="p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center border border-data/50 bg-data/10">
            <MonitorSmartphone className="size-5 text-data" />
          </div>
          <h2 id="takeover-title" className="font-display text-lg font-bold uppercase tracking-wide text-ink">
            Синдикат открыт в другой вкладке
          </h2>
        </div>
        <p className="mt-3 text-[14px] leading-relaxed text-muted">
          Игра продолжилась в другом окне. Эта вкладка остановлена и больше ничего не сохраняет, чтобы не откатить ваш прогресс.
        </p>
        <div className="mt-5 flex justify-end">
          <NeonButton size="md" variant="solid" accent="data" onClick={onTakeOver} data-autofocus>
            Продолжить здесь
          </NeonButton>
        </div>
      </div>
    </Modal>
  );
}
