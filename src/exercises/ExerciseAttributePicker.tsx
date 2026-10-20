import { useRef, useState } from 'react';
import { loadBrowserGlassSettings } from '../glassSettings';
import type { FilterOption } from '../data/exercises/publicExerciseFilters';
import { GlassSurface, LiquidPopover, Text } from '../ui';

type BaseProps = {
  label: string;
  selected: readonly string[];
  options: readonly FilterOption[];
  disabled?: boolean;
  multiple: boolean;
  onSelect: (next: string[]) => void;
};

/** Layout only: the material and presentation are owned by GlassSurface/LiquidPopover. */
function AttributePicker({ label, selected, options, disabled = false, multiple, onSelect }: BaseProps) {
  const triggerRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const settings = loadBrowserGlassSettings();
  const current = selected.map(id => options.find(option => option.id === id)?.label ?? 'Без названия');
  const items = [
    ...(!multiple ? [{ id: '', label: 'Не указано' }] : []),
    ...options,
  ].map(option => ({
    id: option.id,
    label: option.label,
    active: selected.includes(option.id),
    onSelect: () => onSelect(multiple
      ? selected.includes(option.id) ? selected.filter(id => id !== option.id) : [...selected, option.id]
      : option.id ? [option.id] : []),
  }));
  if (multiple) items.unshift({
    id: '__exercise-clear-selection__',
    label: 'Очистить выбор',
    active: false,
    onSelect: () => onSelect([]),
  });

  return <div className="mezfit-personal-exercise-picker">
    <Text variant="footnote" tone="muted">{label}</Text>
    <div className="mezfit-personal-exercise-picker__value-row">
      <Text variant="body">{current.length ? current.join(', ') : 'Не указано'}</Text>
      <LiquidPopover
        isOpen={open} onOpenChange={setOpen} triggerRef={triggerRef}
        label={label} selectionMode={multiple ? 'multi' : 'single'}
        preset={settings.preset} optics={settings.optics} blur={settings.blur}
        items={items}
        trigger={<GlassSurface component="button" ref={triggerRef}
          shape="capsule" blur={0} optics={false}
          aria-label={`Выбрать: ${label}`}
          aria-disabled={disabled}
          className="mezfit-personal-exercise-picker__button"
          onClick={event => { if (disabled) event.preventDefault(); }}>
          <Text variant="body">Выбрать</Text>
        </GlassSurface>} />
    </div>
  </div>;
}

export function SingleExerciseAttributePicker({ label, value, options, disabled, onChange }: {
  label: string;
  value: string | undefined;
  options: readonly FilterOption[];
  disabled?: boolean;
  onChange: (next: string) => void;
}) {
  return <AttributePicker label={label} selected={value ? [value] : []}
    options={options} disabled={disabled} multiple={false}
    onSelect={next => onChange(next[0] ?? '')} />;
}

export function MultiExerciseAttributePicker({ label, value, options, disabled, onChange }: {
  label: string;
  value: readonly string[];
  options: readonly FilterOption[];
  disabled?: boolean;
  onChange: (next: string[]) => void;
}) {
  return <AttributePicker label={label} selected={value} options={options}
    disabled={disabled} multiple onSelect={onChange} />;
}
