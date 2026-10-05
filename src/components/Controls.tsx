import type { ReactNode } from 'react';
import { Icon } from './Icon';

export function Stepper({
  label,
  value,
  onDec,
  onInc,
  onReset,
  disabled,
  decDisabled,
  incDisabled,
  hint,
  icon,
}: {
  label: string;
  value: ReactNode;
  onDec: () => void;
  onInc: () => void;
  onReset?: () => void;
  disabled?: boolean;
  decDisabled?: boolean;
  incDisabled?: boolean;
  hint?: ReactNode;
  icon?: string;
}) {
  return (
    <div className={`ctl ${disabled ? 'disabled' : ''}`}>
      <div className="ctl-label">
        {icon && <Icon name={icon} size={16} />}
        {label}
      </div>
      <div className="stepper">
        <button type="button" className="icon-btn" onClick={onDec} disabled={disabled || decDisabled} aria-label={`ลด${label}`}>
          <Icon name="minus" size={18} />
        </button>
        <button type="button" className="stepper-value" onClick={onReset} disabled={disabled || !onReset} title="กดเพื่อรีเซ็ต">
          {value}
        </button>
        <button type="button" className="icon-btn" onClick={onInc} disabled={disabled || incDisabled} aria-label={`เพิ่ม${label}`}>
          <Icon name="plus" size={18} />
        </button>
      </div>
      {hint && <div className="ctl-hint">{hint}</div>}
    </div>
  );
}

export function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  display,
  disabled,
  hint,
  icon,
  ends,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  display?: ReactNode;
  disabled?: boolean;
  hint?: ReactNode;
  icon?: string;
  ends?: [string, string];
}) {
  return (
    <label className={`ctl ${disabled ? 'disabled' : ''}`}>
      <div className="ctl-label">
        {icon && <Icon name={icon} size={16} />}
        <span>{label}</span>
        {display !== undefined && <span className="ctl-value">{display}</span>}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      {ends && (
        <div className="ctl-ends">
          <span>{ends[0]}</span>
          <span>{ends[1]}</span>
        </div>
      )}
      {hint && <div className="ctl-hint">{hint}</div>}
    </label>
  );
}

export function Toggle({ label, checked, onChange, disabled, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: ReactNode }) {
  return (
    <label className={`toggle ${disabled ? 'disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-thumb" />
      </span>
      <span className="toggle-label">
        <span className="toggle-title">{label}</span>
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}
