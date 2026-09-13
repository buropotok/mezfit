import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Button, Text } from './primitives';

type Role = 'large-title' | 'title' | 'headline' | 'body' | 'footnote' | 'caption';
type TypographyValue = { size: number; lineHeight: number; weight: number };

type RoleDefinition = TypographyValue & {
  role: Role;
  label: string;
  usage: string;
};

const roleDefinitions: RoleDefinition[] = [
  { role: 'large-title', label: 'Large title', usage: 'Main screen title', size: 24, lineHeight: 28, weight: 400 },
  { role: 'title', label: 'Title', usage: 'Large content / section heading', size: 20, lineHeight: 24, weight: 400 },
  { role: 'headline', label: 'Headline', usage: 'Modal title / important compact heading', size: 17, lineHeight: 22, weight: 500 },
  { role: 'body', label: 'Body', usage: 'Main text / inputs / controls', size: 15, lineHeight: 20, weight: 400 },
  { role: 'footnote', label: 'Footnote', usage: 'Metadata / field labels / secondary text', size: 13, lineHeight: 18, weight: 400 },
  { role: 'caption', label: 'Caption', usage: 'Small service / supporting text', size: 12, lineHeight: 16, weight: 400 },
];

const elementDefinitions = [
  { id: 'button', label: 'Button', role: 'body' as Role, weight: 500, preview: <button type="button" className="ui-button ui-button--primary">Primary action</button> },
  { id: 'search', label: 'Search input', role: 'body' as Role, weight: 400, preview: <input className="ui-kit-typography-demo-input" value="Поиск упражнения" readOnly /> },
  { id: 'tab', label: 'Tab', role: 'body' as Role, weight: 500, preview: <button type="button" className="ui-kit-typography-demo-control">Упражнения</button> },
  { id: 'menu', label: 'Menu item', role: 'body' as Role, weight: 500, preview: <button type="button" className="ui-kit-typography-demo-control">Редактировать</button> },
  { id: 'list-primary', label: 'List primary', role: 'body' as Role, weight: 600, preview: <span>Жим лёжа · гантели</span> },
  { id: 'list-secondary', label: 'List secondary', role: 'footnote' as Role, weight: 400, preview: <span>4 подхода · Грудь</span> },
  { id: 'modal-title', label: 'Modal title', role: 'headline' as Role, weight: 500, preview: <span>Пригласить клиента</span> },
  { id: 'section-title', label: 'Section title', role: 'title' as Role, weight: 400, preview: <span>Программа тренировок</span> },
] as const;

function roleDefaults(role: Role, weight?: number): TypographyValue {
  const definition = roleDefinitions.find((item) => item.role === role)!;
  return { size: definition.size, lineHeight: definition.lineHeight, weight: weight ?? definition.weight };
}

function cssFor(value: TypographyValue) {
  return `font-family: var(--ui-font-family);\nfont-size: ${value.size}px;\nline-height: ${value.lineHeight}px;\nfont-weight: ${value.weight};`;
}

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

function NumberField({ label, value, onChange, min, max }: { label: string; value: number; onChange: (value: number) => void; min: number; max: number }) {
  return <label className="ui-kit-admin-field"><Text variant="footnote">{label}</Text><input type="number" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.currentTarget.value))} /></label>;
}

function Editor({ value, onChange, onReset, children }: { value: TypographyValue; onChange: (value: TypographyValue) => void; onReset: () => void; children: ReactNode }) {
  const css = cssFor(value);
  const style = { fontFamily: 'var(--ui-font-family)', fontSize: `${value.size}px`, lineHeight: `${value.lineHeight}px`, fontWeight: value.weight } satisfies CSSProperties;
  return <div className="ui-kit-admin-editor">
    <div className="ui-kit-admin-preview" style={style}>{children}</div>
    <div className="ui-kit-admin-fields">
      <NumberField label="Size" value={value.size} min={12} max={48} onChange={(size) => onChange({ ...value, size })} />
      <NumberField label="Line height" value={value.lineHeight} min={12} max={56} onChange={(lineHeight) => onChange({ ...value, lineHeight })} />
      <label className="ui-kit-admin-field"><Text variant="footnote">Weight</Text><select value={value.weight} onChange={(event) => onChange({ ...value, weight: Number(event.currentTarget.value) })}><option value="400">Regular · 400</option><option value="500">Medium · 500</option><option value="600">Semibold · 600</option><option value="700">Bold · 700</option></select></label>
    </div>
    <pre className="ui-kit-admin-code"><code>{css}</code></pre>
    <div className="ui-kit-admin-actions"><Button variant="secondary" onClick={() => void copyText(css)}>Copy CSS</Button><Button variant="secondary" onClick={onReset}>Reset</Button></div>
  </div>;
}

export function TypographyRoleAdmin() {
  const initial = useMemo(() => Object.fromEntries(roleDefinitions.map((item) => [item.role, roleDefaults(item.role)])) as Record<Role, TypographyValue>, []);
  const [values, setValues] = useState(initial);
  return <div className="ui-kit-admin-list">{roleDefinitions.map((definition) => <div className="ui-kit-admin-card" key={definition.role}>
    <div className="ui-kit-admin-heading"><div><Text variant="headline">{definition.label}</Text><Text variant="footnote" tone="muted">{definition.usage}</Text></div><Text variant="caption" tone="muted">{definition.role}</Text></div>
    <Editor value={values[definition.role]} onChange={(value) => setValues((current) => ({ ...current, [definition.role]: value }))} onReset={() => setValues((current) => ({ ...current, [definition.role]: roleDefaults(definition.role) }))}>
      <Text variant={definition.role}>Пример типографики · {definition.label}</Text>
    </Editor>
  </div>)}</div>;
}

export function ComponentTypographyAdmin() {
  const [selectedId, setSelectedId] = useState<(typeof elementDefinitions)[number]['id']>('button');
  const selected = elementDefinitions.find((item) => item.id === selectedId)!;
  const defaults = roleDefaults(selected.role, selected.weight);
  const [overrides, setOverrides] = useState<Partial<Record<(typeof elementDefinitions)[number]['id'], TypographyValue>>>({});
  const value = overrides[selected.id] ?? defaults;
  return <div className="ui-kit-admin-card">
    <label className="ui-kit-admin-field ui-kit-admin-element-select"><Text variant="footnote">UI Kit element</Text><select value={selectedId} onChange={(event) => setSelectedId(event.currentTarget.value as typeof selectedId)}>{elementDefinitions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    <Text variant="caption" tone="muted">Current semantic role: {selected.role}</Text>
    <Editor value={value} onChange={(next) => setOverrides((current) => ({ ...current, [selected.id]: next }))} onReset={() => setOverrides((current) => { const next = { ...current }; delete next[selected.id]; return next; })}>{selected.preview}</Editor>
  </div>;
}
