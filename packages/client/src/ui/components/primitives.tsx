/**
 * Form and layout primitives shared by every screen. Plain CSS classes from
 * styles/components.css; no external UI library.
 */
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import type { Team } from '@tra/shared';
import { useT } from '../../i18n';
import { clamp, parseIntStrict } from '../logic/format';
import { pingQuality } from '../logic/scoreboard';
import { IconCheck, IconX } from './icons';

// ---- Button ----------------------------------------------------------------

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'team';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  /** Shows a spinner and disables the button. */
  busy?: boolean;
  icon?: ReactNode;
}

export function Button({ variant = 'secondary', size = 'md', block, busy, icon, children, className = '', disabled, type = 'button', ...rest }: ButtonProps) {
  const cls = ['btn', `btn--${variant}`, size !== 'md' ? `btn--${size}` : '', block ? 'btn--block' : '', className].filter(Boolean).join(' ');
  return (
    <button type={type} className={cls} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy ? <span className="btn__spinner" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
}

// ---- Field wrapper -------------------------------------------------------------

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Value readout shown at the end of the label row (sliders). */
  value?: ReactNode;
  inline?: boolean;
  htmlFor?: string;
  children: ReactNode;
}

export function Field({ label, hint, error, value, inline, htmlFor, children }: FieldProps) {
  return (
    <div className={`field${inline ? ' field--inline' : ''}`}>
      <label className="field__label" htmlFor={htmlFor}>
        <span>{label}</span>
        {value !== undefined && <span className="field__value">{value}</span>}
        {inline && hint && <span className="field__hint">{hint}</span>}
      </label>
      {children}
      {!inline && hint && !error && <span className="field__hint">{hint}</span>}
      {error && <span className="field__error" role="alert">{error}</span>}
    </div>
  );
}

// ---- Text input ------------------------------------------------------------------

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  mono?: boolean;
}

export function TextInput({ invalid, mono, className = '', ...rest }: TextInputProps) {
  const cls = ['input', invalid ? 'input--error' : '', mono ? 'input--mono ltr' : '', className].filter(Boolean).join(' ');
  return <input className={cls} spellCheck={false} autoComplete="off" {...rest} />;
}

// ---- Number stepper ---------------------------------------------------------------

export interface NumberStepperProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: ReactNode;
  disabled?: boolean;
  onChange(value: number): void;
  'aria-label'?: string;
}

/**
 * Integer input with −/+ buttons. Typing edits a local draft that is committed
 * (clamped) on blur or Enter, so a host editing lobby settings is not fought
 * by server echoes on every keystroke.
 */
export function NumberStepper({ value, min, max, step = 1, unit, disabled, onChange, ...aria }: NumberStepperProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const parsed = parseIntStrict(draft);
    if (parsed !== null) {
      const next = clamp(parsed, min, max);
      if (next !== value) onChange(next);
    }
    setDraft(null);
  };
  const nudge = (dir: 1 | -1) => onChange(clamp(value + dir * step, min, max));
  return (
    <span className="stepper">
      <button type="button" className="stepper__btn" onClick={() => nudge(-1)} disabled={disabled || value <= min} aria-label="−">−</button>
      <input
        className="stepper__input"
        type="text"
        inputMode="numeric"
        value={draft ?? String(value)}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setDraft(null);
        }}
        aria-label={aria['aria-label']}
      />
      <button type="button" className="stepper__btn" onClick={() => nudge(1)} disabled={disabled || value >= max} aria-label="+">+</button>
      {unit && <span className="stepper__unit">{unit}</span>}
    </span>
  );
}

// ---- Toggle -----------------------------------------------------------------------------

export interface ToggleProps {
  checked: boolean;
  disabled?: boolean;
  onChange(checked: boolean): void;
  'aria-label'?: string;
  id?: string;
}

export function Toggle({ checked, disabled, onChange, id, ...aria }: ToggleProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={aria['aria-label']}
      className="toggle"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

// ---- Slider -------------------------------------------------------------------------------

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange(value: number): void;
  format?(value: number): string;
  id?: string;
}

export function Slider({ value, min, max, step = 1, disabled, onChange, format, id }: SliderProps) {
  const fill = `${((value - min) / (max - min)) * 100}%`;
  return (
    <span className="slider">
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={{ ['--fill' as string]: fill }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="slider__value">{format ? format(value) : String(value)}</span>
    </span>
  );
}

// ---- Segmented control --------------------------------------------------------------------

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  /** Small trailing tag such as "coming soon". */
  tag?: ReactNode;
  title?: string;
}

export interface SegmentedProps<T extends string> {
  value: T;
  options: readonly SegmentedOption<T>[];
  disabled?: boolean;
  onChange(value: T): void;
  'aria-label'?: string;
}

export function Segmented<T extends string>({ value, options, disabled, onChange, ...aria }: SegmentedProps<T>) {
  return (
    <div className="segmented" role="group" aria-label={aria['aria-label']}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="segmented__opt"
          aria-pressed={o.value === value}
          disabled={disabled || o.disabled}
          title={o.title}
          onClick={() => o.value !== value && onChange(o.value)}
        >
          {o.label}
          {o.tag && <span className="segmented__tag">{o.tag}</span>}
        </button>
      ))}
    </div>
  );
}

// ---- Select -----------------------------------------------------------------------------------

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
}

export interface SelectProps<T extends string | number> {
  value: T;
  options: readonly SelectOption<T>[];
  disabled?: boolean;
  small?: boolean;
  onChange(value: T): void;
  'aria-label'?: string;
  id?: string;
}

export function Select<T extends string | number>({ value, options, disabled, small, onChange, id, ...aria }: SelectProps<T>) {
  return (
    <select
      id={id}
      className={`select${small ? ' select--sm' : ''}`}
      value={String(value)}
      disabled={disabled}
      aria-label={aria['aria-label']}
      onChange={(e) => {
        const match = options.find((o) => String(o.value) === e.target.value);
        if (match) onChange(match.value);
      }}
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
      ))}
    </select>
  );
}

// ---- Badge / ping / team --------------------------------------------------------------------------

export type BadgeTone = 'brass' | 'team' | 'ok' | 'danger' | 'muted' | 'plain';

export function Badge({ tone = 'plain', title, children }: { tone?: BadgeTone; title?: string; children: ReactNode }) {
  return <span className={`badge${tone !== 'plain' ? ` badge--${tone}` : ''}`} title={title}>{children}</span>;
}

export function Ping({ ms, isBot }: { ms: number; isBot?: boolean }) {
  if (isBot) return <span className="ping muted">—</span>;
  return <span className={`ping ping--${pingQuality(ms)}`}>{Math.round(ms)} ms</span>;
}

export function TeamName({ team }: { team: Team }) {
  const t = useT();
  return <span className={`text-${team}`}>{t(team === 'tigris' ? 'team.tigris' : 'team.euphrates')}</span>;
}

// ---- Panel ---------------------------------------------------------------------------------------------

export interface PanelProps {
  title?: ReactNode;
  actions?: ReactNode;
  glass?: boolean;
  flush?: boolean;
  className?: string;
  children: ReactNode;
}

export function Panel({ title, actions, glass, flush, className = '', children }: PanelProps) {
  return (
    <section className={`panel${glass ? ' panel--glass' : ''} ${className}`.trim()}>
      {(title || actions) && (
        <header className="panel__head">
          <h3 className="panel__title">{title}</h3>
          {actions}
        </header>
      )}
      <div className={`panel__body${flush ? ' panel__body--flush' : ''}`}>{children}</div>
    </section>
  );
}

// ---- Dialogs -------------------------------------------------------------------------------------------

export interface DialogProps {
  title: ReactNode;
  children?: ReactNode;
  actions: ReactNode;
  /** Escape / backdrop click. */
  onClose?(): void;
}

export function Dialog({ title, children, actions, onClose }: DialogProps) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button, input, select')?.focus();
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div className="dialog-backdrop interactive" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div ref={ref} className="panel panel--glass dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId} className="dialog__title">{title}</h2>
        {children && <div className="dialog__body">{children}</div>}
        <div className="dialog__actions">{actions}</div>
      </div>
    </div>
  );
}

export interface ConfirmDialogProps {
  title: ReactNode;
  body?: ReactNode;
  confirmLabel: ReactNode;
  danger?: boolean;
  onConfirm(): void;
  onCancel(): void;
}

export function ConfirmDialog({ title, body, confirmLabel, danger, onConfirm, onCancel }: ConfirmDialogProps) {
  const t = useT();
  return (
    <Dialog
      title={title}
      onClose={onCancel}
      actions={
        <>
          <Button variant="ghost" onClick={onCancel}>{t('common.cancel')}</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      }
    >
      {body}
    </Dialog>
  );
}

// ---- Tabs ---------------------------------------------------------------------------------------------------

export interface TabDef<T extends string> {
  id: T;
  label: ReactNode;
}

export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: readonly TabDef<T>[]; onChange(id: T): void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button key={tab.id} type="button" role="tab" className="tab" aria-selected={tab.id === value} onClick={() => onChange(tab.id)}>
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ---- Misc ---------------------------------------------------------------------------------------------------------

export function StatBar({ label, value, display }: { label: ReactNode; value: number; display: string }) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className="stat__track"><span className="stat__fill" style={{ width: `${Math.round(value * 100)}%` }} /></span>
      <span className="stat__value">{display}</span>
    </div>
  );
}

export function Progress({ value }: { value: number }) {
  const pct = Math.round(clamp(value, 0, 1) * 100);
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <div className="progress__fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

export function Notice({ tone = 'brass', icon, title, children }: { tone?: 'brass' | 'danger' | 'info'; icon?: ReactNode; title?: ReactNode; children: ReactNode }) {
  return (
    <div className={`notice${tone !== 'brass' ? ` notice--${tone}` : ''}`} role={tone === 'danger' ? 'alert' : undefined}>
      {icon && <span className="notice__icon">{icon}</span>}
      <div className="notice__body">
        {title && <div className="notice__title">{title}</div>}
        {children}
      </div>
    </div>
  );
}

/** Selection tick used by picker cards. */
export function CardCheck() {
  return <span className="card__check" aria-hidden="true"><IconCheck size={14} /></span>;
}

export function CloseButton({ onClick, label }: { onClick(): void; label: string }) {
  return (
    <Button variant="ghost" size="sm" className="btn--icon" onClick={onClick} aria-label={label} title={label}>
      <IconX size={16} />
    </Button>
  );
}
