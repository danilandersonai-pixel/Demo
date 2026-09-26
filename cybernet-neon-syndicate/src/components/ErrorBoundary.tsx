import { Component, type ErrorInfo, type ReactNode } from 'react';
import { clearSave } from '../game/storage.ts';

interface State {
  error: Error | null;
}

/**
 * Страховка: если что-то сломалось при отрисовке (например, сейв подправлен вручную),
 * показываем экран сбоя с кнопкой сброса вместо пустой страницы.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('CyberNet: сбой интерфейса', error, info.componentStack);
  }

  private reset = (): void => {
    clearSave();
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid min-h-screen place-items-center bg-void p-6 text-ink">
        <div className="panel max-w-md border-danger/50 p-6">
          <div className="font-mono text-[10px] tracking-[0.3em] text-danger">KERNEL PANIC</div>
          <h1 className="mt-1 font-display text-xl font-bold uppercase">Сбой командного центра</h1>
          <p className="mt-3 text-[14px] leading-relaxed text-muted">
            Сохранение повреждено или несовместимо. Сбросьте текущий забег — рекорды и Зал славы сохранятся.
          </p>
          <p className="mt-2 break-words font-mono text-[11px] text-dim">{this.state.error.message}</p>
          <button
            type="button"
            onClick={this.reset}
            className="chamfer mt-5 h-10 bg-danger px-4 font-mono text-[13px] font-semibold uppercase tracking-wider text-void"
          >
            Сбросить забег и перезапустить
          </button>
        </div>
      </div>
    );
  }
}
