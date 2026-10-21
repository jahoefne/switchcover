/**
 * Compact, keyboard-friendly form controls. Number inputs keep their own text while
 * focused, commit valid in-range values live and clamp on blur / Enter.
 */
import { useEffect, useId, useState, type ReactNode } from 'react';

const formatNumber = (n: number) => (Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '');

function parseNumber(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (t === '' || t === '-' || t === '.') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

interface NumberInputProps {
  value: number;
  onChange(value: number): void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  integer?: boolean;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
  ariaDescribedBy?: string;
}

export function NumberInput({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  unit,
  integer,
  disabled,
  id,
  ariaLabel,
  ariaDescribedBy,
}: NumberInputProps) {
  const [text, setText] = useState(() => formatNumber(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(formatNumber(value));
  }, [value, focused]);

  const valid = (n: number) => n >= min && n <= max && (!integer || Number.isInteger(n));
  const clamp = (n: number) => {
    const c = Math.min(max, Math.max(min, n));
    return integer ? Math.round(c) : c;
  };
  const commit = () => {
    const n = parseNumber(text);
    if (n === null) {
      setText(formatNumber(value));
      return;
    }
    const c = clamp(n);
    if (c !== value) onChange(c);
    setText(formatNumber(c));
  };

  return (
    <span className={`num${unit ? ' has-unit' : ''}`}>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        value={text}
        min={Number.isFinite(min) ? min : undefined}
        max={Number.isFinite(max) ? max : undefined}
        step={step}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        onFocus={() => setFocused(true)}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseNumber(e.target.value);
          if (n !== null && valid(n) && n !== value) onChange(n);
        }}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setText(formatNumber(value));
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {unit && <span className="unit" aria-hidden="true">{unit}</span>}
    </span>
  );
}

interface FieldShellProps {
  label: ReactNode;
  hint?: ReactNode;
  children(id: string, hintId: string | undefined): ReactNode;
  className?: string;
}

function FieldShell({ label, hint, children, className }: FieldShellProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className={`field${className ? ` ${className}` : ''}`}>
      <label htmlFor={id}>{label}</label>
      <div className="control">{children(id, hintId)}</div>
      {hint && (
        <p className="hint" id={hintId}>
          {hint}
        </p>
      )}
    </div>
  );
}

export interface NumberFieldProps extends Omit<NumberInputProps, 'id' | 'ariaLabel' | 'ariaDescribedBy'> {
  label: ReactNode;
  hint?: ReactNode;
}

export function NumberField({ label, hint, ...input }: NumberFieldProps) {
  return (
    <FieldShell label={label} hint={hint}>
      {(id, hintId) => <NumberInput id={id} ariaDescribedBy={hintId} {...input} />}
    </FieldShell>
  );
}

export interface SliderFieldProps extends NumberFieldProps {
  min: number;
  max: number;
}

export function SliderField({ label, hint, ...input }: SliderFieldProps) {
  const { value, onChange, min, max, step = 1, disabled } = input;
  return (
    <FieldShell label={label} hint={hint} className="slider-field">
      {(id, hintId) => (
        <>
          <input
            type="range"
            className="range"
            min={min}
            max={max}
            step={step}
            value={Math.min(max, Math.max(min, value))}
            disabled={disabled}
            aria-label={typeof label === 'string' ? `${label} slider` : undefined}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          <NumberInput id={id} ariaDescribedBy={hintId} {...input} />
        </>
      )}
    </FieldShell>
  );
}

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

interface SelectFieldProps<T extends string> {
  label: ReactNode;
  value: T;
  options: readonly SelectOption<T>[];
  onChange(value: T): void;
  hint?: ReactNode;
  disabled?: boolean;
}

export function SelectField<T extends string>({ label, value, options, onChange, hint, disabled }: SelectFieldProps<T>) {
  return (
    <FieldShell label={label} hint={hint}>
      {(id, hintId) => (
        <select id={id} value={value} disabled={disabled} aria-describedby={hintId} onChange={(e) => onChange(e.target.value as T)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </FieldShell>
  );
}

interface CheckFieldProps {
  label: ReactNode;
  checked: boolean;
  onChange(checked: boolean): void;
  hint?: ReactNode;
  disabled?: boolean;
}

export function CheckField({ label, checked, onChange, hint, disabled }: CheckFieldProps) {
  const id = useId();
  return (
    <div className="field check-field">
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id}>{label}</label>
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

interface SegmentedProps<T extends string | number> {
  label: ReactNode;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange(value: T): void;
}

/** Radio group rendered as a segmented button bar (arrow keys move within the group). */
export function Segmented<T extends string | number>({ label, value, options, onChange }: SegmentedProps<T>) {
  const name = useId();
  return (
    <div className="field">
      <span className="label" id={`${name}-label`}>
        {label}
      </span>
      <div className="control segmented" role="radiogroup" aria-labelledby={`${name}-label`}>
        {options.map((o) => (
          <label key={String(o.value)} className={o.value === value ? 'on' : undefined}>
            <input type="radio" name={name} checked={o.value === value} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** Two number inputs side by side (e.g. w × h), sharing one label. */
export function PairField({
  label,
  a,
  b,
  hint,
}: {
  label: ReactNode;
  a: Omit<NumberInputProps, 'id'> & { ariaLabel: string };
  b: Omit<NumberInputProps, 'id'> & { ariaLabel: string };
  hint?: ReactNode;
}) {
  return (
    <FieldShell label={label} hint={hint} className="pair-field">
      {(id, hintId) => (
        <>
          <NumberInput id={id} ariaDescribedBy={hintId} {...a} />
          <span className="times" aria-hidden="true">
            ×
          </span>
          <NumberInput ariaDescribedBy={hintId} {...b} />
        </>
      )}
    </FieldShell>
  );
}
