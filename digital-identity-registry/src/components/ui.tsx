/**
 * Тихие базовые элементы. Единственное яркое место интерфейса — карта связей,
 * поэтому кнопки, поля и бейджи сознательно сдержанные.
 */
import {
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import type { Criticality } from '../types'

export function Button({
  variant = 'ghost',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const styles = {
    primary: 'bg-brass text-panel hover:bg-brass/85 font-medium',
    ghost: 'border border-panel-edge text-ink hover:border-brass/60 hover:text-brass',
    danger: 'border border-danger/50 text-danger hover:bg-danger/10',
  }[variant]
  return (
    <button
      className={`cursor-pointer rounded-md px-3.5 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${styles} ${className}`}
      {...rest}
    />
  )
}

export function TextInput({
  className = '',
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-md border border-panel-edge bg-panel-raised px-3 py-2 text-sm text-ink placeholder:text-ink-dim/60 focus:border-brass ${className}`}
      {...rest}
    />
  )
}

export function TextArea({
  className = '',
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`w-full rounded-md border border-panel-edge bg-panel-raised px-3 py-2 text-sm text-ink placeholder:text-ink-dim/60 focus:border-brass ${className}`}
      {...rest}
    />
  )
}

export function Select({
  className = '',
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`w-full rounded-md border border-panel-edge bg-panel-raised px-3 py-2 text-sm text-ink focus:border-brass ${className}`}
      {...rest}
    />
  )
}

export function Labeled({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: string
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-ink-dim">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-ink-dim/80">{hint}</span> : null}
    </label>
  )
}

/** Адреса, домены, номера — всегда моноширинным: в нём видно разницу l/1. */
export function Mono({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono text-[0.92em] ${className}`}>{children}</span>
}

export const CRITICALITY_COLORS: Record<Criticality, string> = {
  critical: 'var(--color-cable-critical)',
  normal: 'var(--color-cable-normal)',
  disposable: 'var(--color-cable-disposable)',
}

export function CriticalityDot({ criticality }: { criticality: Criticality }) {
  return (
    <span
      aria-hidden
      className="inline-block size-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: CRITICALITY_COLORS[criticality] }}
    />
  )
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'brass' | 'danger' | 'ok'
}) {
  const tones = {
    neutral: 'border-panel-edge text-ink-dim',
    brass: 'border-brass/50 text-brass',
    danger: 'border-danger/60 text-danger',
    ok: 'border-cable-disposable/70 text-moss',
  }[tone]
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs whitespace-nowrap ${tones}`}>
      {children}
    </span>
  )
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-panel-edge p-8 text-center">
      <p className="font-display text-sm text-ink-dim">{title}</p>
      {children ? <div className="mt-3 text-sm text-ink-dim">{children}</div> : null}
    </div>
  )
}

/**
 * Модальное окно: Esc закрывает, фокус при открытии уходит внутрь,
 * Tab не выпускает фокус наружу (простая ловушка по крайним элементам).
 */
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const previous = document.activeElement as HTMLElement | null
    const focusables = () =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute('disabled'))
    focusables()[0]?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus()
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`my-8 w-full ${wide ? 'max-w-2xl' : 'max-w-md'} rounded-xl border border-panel-edge bg-panel p-5 shadow-2xl`}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="font-display text-sm text-brass">{title}</h2>
          <Button aria-label="Закрыть" onClick={onClose} className="px-2.5 py-1">
            ✕
          </Button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** Строка ошибки формы: заметная, но без истерики. */
export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null
  return (
    <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
      {children}
    </p>
  )
}
