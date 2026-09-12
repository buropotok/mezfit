import { forwardRef, useState, type InputHTMLAttributes } from 'react';
import './search-input.css';

export type SearchInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { onClear?: () => void; clearLabel?: string; };

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput({ className = '', value, defaultValue, onChange, onFocus, onBlur, onClear, clearLabel = 'Очистить поиск', disabled, ...props }, ref) {
  const [focused, setFocused] = useState(false);
  const [uncontrolledValue, setUncontrolledValue] = useState(() => String(defaultValue ?? ''));
  const currentValue = value === undefined ? uncontrolledValue : String(value ?? '');
  const canClear = currentValue.length > 0 && !disabled;
  const canClearValue = value === undefined || Boolean(onClear);
  return <div className={`ui-search-input${focused ? ' ui-search-input--focused' : ''}${disabled ? ' ui-search-input--disabled' : ''} ${className}`.trim()}>
    <span className="ui-search-input__search-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.25 4.25" /></svg></span>
    <input {...props} ref={ref} type="search" role="searchbox" value={currentValue} disabled={disabled} onChange={(event) => { if (value === undefined) setUncontrolledValue(event.currentTarget.value); onChange?.(event); }} onFocus={(event) => { setFocused(true); onFocus?.(event); }} onBlur={(event) => { setFocused(false); onBlur?.(event); }} className="ui-search-input__field" />
    <button type="button" className={`ui-search-input__clear${canClear && canClearValue ? ' ui-search-input__clear--visible' : ''}`} aria-label={clearLabel} tabIndex={canClear && canClearValue ? 0 : -1} aria-hidden={!(canClear && canClearValue) || undefined} disabled={!(canClear && canClearValue)} onMouseDown={(event) => event.preventDefault()} onClick={() => { if (value === undefined) setUncontrolledValue(''); onClear?.(); }}><svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg></button>
  </div>;
});
