import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import './form-controls.css';

type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  label?: string;
  error?: string;
  success?: string;
};

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { id, label, error, success, className = '', value, defaultValue, ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hasValue = value !== undefined ? String(value).length > 0 : defaultValue !== undefined && String(defaultValue).length > 0;
  const stateClass = error ? ' ui-text-input--error' : success ? ' ui-text-input--success' : '';

  return (
    <div className={`ui-text-input${hasValue ? ' ui-text-input--filled' : ''}${stateClass} ${className}`.trim()}>
      <input ref={ref} id={inputId} className="ui-text-input__field" value={value} defaultValue={defaultValue} aria-invalid={error ? true : undefined} {...props} />
      {label ? <label className="ui-text-input__label" htmlFor={inputId}>{error || success || label}</label> : null}
    </div>
  );
});

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label?: ReactNode };

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { id, label, className = '', ...props }, ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return <label className={`ui-choice ui-checkbox ${className}`.trim()} htmlFor={inputId}>
    <input ref={ref} id={inputId} type="checkbox" {...props} />
    <span className="ui-choice__control" aria-hidden="true"><span className="ui-checkbox__check">✓</span></span>
    {label !== undefined ? <span className="ui-choice__label">{label}</span> : null}
  </label>;
});

export type RadioProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label?: ReactNode };

export const Radio = forwardRef<HTMLInputElement, RadioProps>(function Radio(
  { id, label, className = '', ...props }, ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return <label className={`ui-choice ui-radio ${className}`.trim()} htmlFor={inputId}>
    <input ref={ref} id={inputId} type="radio" {...props} />
    <span className="ui-choice__control" aria-hidden="true"><span className="ui-radio__dot" /></span>
    {label !== undefined ? <span className="ui-choice__label">{label}</span> : null}
  </label>;
});
