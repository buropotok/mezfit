import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import './form-controls.css';

type FormFeedbackProps = {
  label?: string;
  error?: string;
  success?: string;
};

export type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & FormFeedbackProps & {
  textAlign?: 'left' | 'center' | 'right';
  showNumberControls?: boolean;
};

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { id, label, error, success, textAlign = 'left', showNumberControls = true, className = '', value, defaultValue, placeholder, 'aria-describedby': ariaDescribedBy, ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const feedback = error ?? success;
  const feedbackId = feedback ? `${inputId}-feedback` : undefined;
  const describedBy = [ariaDescribedBy, feedbackId].filter(Boolean).join(' ') || undefined;
  const hasValue = value !== undefined ? String(value).length > 0 : defaultValue !== undefined && String(defaultValue).length > 0;
  const stateClass = error ? ' ui-text-input--error' : success ? ' ui-text-input--success' : '';
  const placeholderClass = label && placeholder ? ' ui-text-input--has-placeholder' : '';
  const numberControlsClass = props.type === 'number' && !showNumberControls ? ' ui-text-input--hide-number-controls' : '';

  return (
    <div className={`ui-text-input ui-text-input--align-${textAlign}${hasValue ? ' ui-text-input--filled' : ''}${placeholderClass}${stateClass}${numberControlsClass} ${className}`.trim()}>
      <input
        ref={ref}
        id={inputId}
        className="ui-text-input__field"
        value={value}
        defaultValue={defaultValue}
        placeholder={placeholder ?? (label ? ' ' : undefined)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...props}
      />
      {label ? <label className="ui-text-input__label" htmlFor={inputId}>{label}</label> : null}
      {feedback ? <span id={feedbackId} className="ui-text-input__feedback">{feedback}</span> : null}
    </div>
  );
});

export type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & FormFeedbackProps;

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { id, label, error, success, className = '', value, defaultValue, placeholder, 'aria-describedby': ariaDescribedBy, ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const feedback = error ?? success;
  const feedbackId = feedback ? `${inputId}-feedback` : undefined;
  const describedBy = [ariaDescribedBy, feedbackId].filter(Boolean).join(' ') || undefined;
  const hasValue = value !== undefined ? String(value).length > 0 : defaultValue !== undefined && String(defaultValue).length > 0;
  const stateClass = error ? ' ui-text-input--error' : success ? ' ui-text-input--success' : '';
  const placeholderClass = label && placeholder ? ' ui-text-input--has-placeholder' : '';

  return (
    <div className={`ui-text-input ui-text-area${hasValue ? ' ui-text-input--filled' : ''}${placeholderClass}${stateClass} ${className}`.trim()}>
      <textarea
        ref={ref}
        id={inputId}
        className="ui-text-input__field ui-text-area__field"
        value={value}
        defaultValue={defaultValue}
        placeholder={placeholder ?? (label ? ' ' : undefined)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...props}
      />
      {label ? <label className="ui-text-input__label" htmlFor={inputId}>{label}</label> : null}
      {feedback ? <span id={feedbackId} className="ui-text-input__feedback">{feedback}</span> : null}
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
