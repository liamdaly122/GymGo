/**
 * Shared primitives.
 *
 * Sized for a phone held in one hand, mid-set, with chalk on your fingers:
 * targets are at least 44px, numeric fields open the numeric keypad, and
 * nothing important hides behind a hover state.
 */
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-ink font-semibold active:bg-accent/80',
  secondary: 'bg-raised text-white border border-line active:bg-line',
  ghost: 'text-muted active:text-white',
  danger: 'bg-red-500/15 text-red-400 border border-red-500/30 active:bg-red-500/25',
};

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      {...props}
      className={`min-h-11 rounded-xl px-4 text-sm transition-colors disabled:opacity-40 ${BUTTON_STYLES[variant]} ${className}`}
    />
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-line bg-surface ${className}`}>{children}</div>
  );
}

/**
 * Numeric entry for weights and reps.
 *
 * `inputMode="decimal"` rather than `type="number"` so iOS shows a keypad
 * without the spinner arrows stealing width, and so a part-typed value like
 * "2." does not get eaten by the browser mid-keystroke.
 */
export function NumberField({
  value,
  onCommit,
  suffix,
  blankWhenZero = false,
  className = '',
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: number | null;
  onCommit: (value: number) => void;
  suffix?: string;
  /**
   * Render 0 as an empty box so the field's placeholder can show, letting an
   * unlogged set display last session's number as a hint rather than a
   * misleading zero.
   */
  blankWhenZero?: boolean;
}) {
  const initial = value === null || (blankWhenZero && value === 0) ? '' : String(value);
  return (
    // flex-1 so a row of fields shares width evenly and lines up under its headings.
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
        className={`h-11 w-full rounded-lg border border-line bg-raised text-center text-base tabular-nums text-white placeholder:text-muted/50 focus:border-accent focus:outline-none ${className}`}
      />
      {suffix ? (
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted">
          {suffix}
        </span>
      ) : null}
    </div>
  );
}

export function Screen({ children, className = '' }: { children: ReactNode; className?: string }) {
  // pb-28 clears the fixed bottom navigation. <main> rather than <div> so every
  // screen carries the one landmark that lets a screen reader skip the nav.
  return <main className={`mx-auto min-h-dvh max-w-lg px-4 pb-28 pt-4 ${className}`}>{children}</main>;
}

export function ScreenTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-4 flex items-baseline justify-between gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">{children}</h1>
      {action}
    </header>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-6 py-10 text-center">
      <p className="text-sm text-white">{title}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function Pill({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'accent' }) {
  const styles =
    tone === 'accent' ? 'bg-accent/15 text-accent' : 'bg-raised text-muted border border-line';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] ${styles}`}>
      {children}
    </span>
  );
}
