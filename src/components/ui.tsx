/**
 * Shared primitives for the "Bold" design.
 *
 * Sized for a phone held in one hand, mid-set, with chalk on your fingers:
 * targets are at least 44px, numeric fields open the numeric keypad, and
 * nothing important hides behind a hover state. The look lives in the
 * component classes in index.css; these components only decide which apply.
 */
import { useEffect, useRef } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from './icons';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  variant = 'secondary',
  size,
  block = false,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: 'sm' | 'lg';
  block?: boolean;
}) {
  return (
    <button
      type="button"
      {...props}
      className={`btn btn-${variant} ${size ? `btn-${size}` : ''} ${block ? 'btn-block' : ''} ${className}`}
    />
  );
}

/** A quiet panel, for grouping on the read-only screens. */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-md bg-surface ${className}`}>{children}</div>;
}

/**
 * Numeric entry for forms: routine targets, gym plates, settings.
 *
 * `inputMode="decimal"` rather than `type="number"` so iOS shows a keypad
 * without the spinner arrows stealing width, and so a part-typed value like
 * "2." does not get eaten by the browser mid-keystroke.
 */
const FIELD_SIZES = {
  log: 'h-16 text-3xl',
  read: 'h-12 text-lg',
  done: 'h-11 text-sm text-muted',
} as const;

export function NumberField({
  value,
  onCommit,
  suffix,
  blankWhenZero = false,
  size = 'read',
  className = '',
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'size'> & {
  value: number | null;
  onCommit: (value: number) => void;
  suffix?: string;
  /** Render 0 as an empty box so the placeholder can show. */
  blankWhenZero?: boolean;
  size?: keyof typeof FIELD_SIZES;
}) {
  const initial = value === null || (blankWhenZero && value === 0) ? '' : String(value);
  return (
    <div className="relative flex-1">
      <input
        {...props}
        inputMode="decimal"
        defaultValue={initial}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={(event) => {
          const parsed = Number.parseFloat(event.currentTarget.value.replace(',', '.'));
          onCommit(Number.isFinite(parsed) && parsed >= 0 ? parsed : 0);
        }}
        className={`w-full rounded-md border border-line bg-raised text-center font-semibold tabular-nums text-chalk placeholder:text-faint focus:border-hot focus:outline-none ${FIELD_SIZES[size]} ${className}`}
      />
      {suffix ? (
        <span className="pointer-events-none absolute bottom-1.5 right-2 text-[10px] text-muted">
          {suffix}
        </span>
      ) : null}
    </div>
  );
}

export function Screen({ children, className = '' }: { children: ReactNode; className?: string }) {
  // <main> so every screen carries the one landmark that lets a screen reader
  // skip the tab bar.
  return <main className={`screen ${className}`}>{children}</main>;
}

/**
 * A screen's heading: a small label over a poster-sized title, with an
 * optional action on the right. A screen whose design has no visible title
 * still passes one, rendered for screen readers only, so every screen has an h1.
 */
export function ScreenHeader({
  title,
  label,
  action,
  hideTitle = false,
}: {
  title: string;
  label?: ReactNode;
  action?: ReactNode;
  hideTitle?: boolean;
}) {
  return (
    <header className="top">
      <div className="top-txt">
        {label ? <p className="t-label">{label}</p> : null}
        <h1 className={hideTitle ? 'sr-only' : 't-title'}>{title}</h1>
      </div>
      {action}
    </header>
  );
}

/** The older two-part API, kept so a screen can move over one at a time. */
export function ScreenTitle({ children, action }: { children: string; action?: ReactNode }) {
  return <ScreenHeader title={children} action={action} />;
}

/** "← Plan" — the way back from a detail screen. */
export function BackLink({ to, children }: { to: string; children: string }) {
  return (
    <div className="pt-2.5">
      <Link to={to} className="back-btn">
        <Icon name="back" />
        {children}
      </Link>
    </div>
  );
}

export function SectionLabel({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 className="t-section" id={id}>
      {children}
    </h2>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-md border border-dashed border-line px-6 py-10 text-center">
      <p className="text-sm text-chalk">{title}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function Pill({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'accent' | 'warn' }) {
  return (
    <span className={`chip ${tone === 'accent' ? 'chip-hot' : tone === 'warn' ? 'chip-warn' : ''}`}>
      {children}
    </span>
  );
}

/** A row of mutually exclusive choices. Each option is a real button with aria-pressed. */
export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  idPrefix,
}: {
  label: string;
  options: Array<{ value: T; label: ReactNode }>;
  value: T;
  onChange: (value: T) => void;
  idPrefix?: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          id={idPrefix ? `${idPrefix}-${option.value}` : undefined}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A bottom sheet. Opens under the thumb, closes on the backdrop or Escape, and
 * takes focus when it opens so a keyboard or screen reader lands inside it.
 */
export function Sheet({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="sheet-wrap"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div ref={ref} className="sheet" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        <span className="sheet-grip" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}

export function Stat({ label, value, unit }: { label: string; value: ReactNode; unit?: string }) {
  return (
    <div className="stat">
      <span className="t-label">{label}</span>
      <strong>{value}</strong>
      {unit ? <span className="t-meta">{unit}</span> : null}
    </div>
  );
}
