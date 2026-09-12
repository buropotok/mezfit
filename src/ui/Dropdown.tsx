import { useState, type ReactNode } from 'react';
import { Button } from './primitives';
import { List, ListItem, Modal } from './components';
import './Dropdown.css';

export type DropdownOption = {
  value: string;
  label: ReactNode;
  displayLabel?: string;
  disabled?: boolean;
};

type DropdownBaseProps = {
  options: DropdownOption[];
  title?: ReactNode;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

export type SingleDropdownProps = DropdownBaseProps & {
  mode: 'single';
  value: string | null;
  onChange: (value: string) => void;
};

export type MultiDropdownProps = DropdownBaseProps & {
  mode: 'multi';
  value: string[];
  onChange: (value: string[]) => void;
  confirmLabel?: string;
};

export type DropdownProps = SingleDropdownProps | MultiDropdownProps;

function optionText(option: DropdownOption) {
  return option.displayLabel ?? (typeof option.label === 'string' ? option.label : option.value);
}

export function Dropdown(props: DropdownProps) {
  const { options, title = 'Выберите вариант', placeholder = 'Выбрать', disabled = false, className = '' } = props;
  const [isOpen, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);

  const selectedValues = props.mode === 'single' ? (props.value === null ? [] : [props.value]) : props.value;
  const selectedLabels = selectedValues
    .map((value) => options.find((option) => option.value === value))
    .filter((option): option is DropdownOption => option !== undefined)
    .map(optionText);
  const triggerLabel = selectedLabels.length > 0 ? selectedLabels.join(', ') : placeholder;

  const open = () => {
    if (disabled) return;
    if (props.mode === 'multi') setDraft(props.value);
    setOpen(true);
  };

  const close = () => {
    if (props.mode === 'multi') props.onChange(draft);
    setOpen(false);
  };

  const selectSingle = (value: string) => {
    if (props.mode !== 'single') return;
    props.onChange(value);
    setOpen(false);
  };

  const toggleMulti = (value: string) => {
    if (props.mode !== 'multi') return;
    setDraft((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  };

  const activeValues = props.mode === 'multi' ? draft : selectedValues;

  return <>
    <button type="button" className={`ui-dropdown__trigger ${className}`.trim()} onClick={open} disabled={disabled} aria-haspopup="dialog" aria-expanded={isOpen}>{triggerLabel}</button>
    <Modal isOpen={isOpen} title={title} onClose={close} className="ui-dropdown__modal">
      <div className="ui-dropdown__options">
        <List>
          {options.map((option) => {
            const selected = activeValues.includes(option.value);
            const leading = props.mode === 'multi'
              ? <span className={`ui-dropdown__checkbox${selected ? ' ui-dropdown__checkbox--checked' : ''}`} aria-hidden="true">{selected ? '✓' : ''}</span>
              : undefined;
            const trailing = props.mode === 'single' && selected ? <span className="ui-dropdown__check" aria-hidden="true">✓</span> : undefined;
            return <ListItem key={option.value} title={option.label} leading={leading} trailing={trailing} disabled={option.disabled} aria-pressed={selected} onClick={() => props.mode === 'single' ? selectSingle(option.value) : toggleMulti(option.value)} />;
          })}
        </List>
      </div>
      {props.mode === 'multi' ? <div className="ui-dropdown__footer"><Button className="ui-dropdown__confirm" onClick={close}>{props.confirmLabel ?? 'OK'}</Button></div> : null}
    </Modal>
  </>;
}
