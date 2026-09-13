import { useState, type CSSProperties } from 'react';
import { Button, Text } from './primitives';

export type TypographyRole = 'large-title' | 'title' | 'headline' | 'body' | 'footnote' | 'caption';
export type TypographyValue = { size: number; lineHeight: number; weight: number };
export type TypographyValues = Record<TypographyRole, TypographyValue>;
export type TypographySlot = { id: string; label: string; defaultRole: TypographyRole };
export type TypographyAssignments = Record<string, TypographyRole>;

export const roleDefinitions: ReadonlyArray<TypographyValue & { role: TypographyRole; label: string; usage: string }> = [
  { role: 'large-title', label: 'Large title', usage: 'Main screen title', size: 24, lineHeight: 28, weight: 400 },
  { role: 'title', label: 'Title', usage: 'Large content / section heading', size: 20, lineHeight: 24, weight: 400 },
  { role: 'headline', label: 'Headline', usage: 'Modal title / important compact heading', size: 17, lineHeight: 22, weight: 500 },
  { role: 'body', label: 'Body', usage: 'Main text / inputs / controls', size: 15, lineHeight: 20, weight: 400 },
  { role: 'footnote', label: 'Footnote', usage: 'Metadata / field labels / secondary text', size: 13, lineHeight: 18, weight: 400 },
  { role: 'caption', label: 'Caption', usage: 'Small service / supporting text', size: 12, lineHeight: 16, weight: 400 },
];

export function defaultTypographyValues(): TypographyValues {
  return Object.fromEntries(roleDefinitions.map(({ role, size, lineHeight, weight }) => [role, { size, lineHeight, weight }])) as TypographyValues;
}

export function typographyStyle(value: TypographyValue): CSSProperties {
  return { fontFamily: 'var(--ui-font-family)', fontSize: `${value.size}px`, lineHeight: `${value.lineHeight}px`, fontWeight: value.weight };
}

function cssFor(value: TypographyValue) {
  return `font-family: var(--ui-font-family);\nfont-size: ${value.size}px;\nline-height: ${value.lineHeight}px;\nfont-weight: ${value.weight};`;
}

function NumberField({ label, value, onChange, min, max }: { label: string; value: number; onChange: (value: number) => void; min: number; max: number }) {
  return <label className="ui-kit-admin-field"><Text variant="footnote" className="ui-kit-admin-field-label">{label}</Text><input type="number" min={min} max={max} value={value} onChange={(event) => { const next = event.currentTarget.valueAsNumber; if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next))); }} /></label>;
}

function CopyActions({ css, onReset }: { css: string; onReset: () => void }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  async function copy() { try { if (!navigator.clipboard?.writeText) throw new Error(); await navigator.clipboard.writeText(css); setStatus('copied'); } catch { setStatus('error'); } }
  return <><div className="ui-kit-admin-actions"><Button variant="secondary" onClick={() => void copy()}>Copy CSS</Button><Button variant="secondary" onClick={() => { setStatus('idle'); onReset(); }}>Reset</Button></div>{status !== 'idle' && <Text variant="caption" tone={status === 'error' ? 'default' : 'muted'} role="status">{status === 'copied' ? 'CSS copied.' : 'Could not copy CSS. Select the CSS above and copy it manually.'}</Text>}</>;
}

export function TypographyRoleAdmin({ values, onChange }: { values: TypographyValues; onChange: (values: TypographyValues) => void }) {
  return <div className="ui-kit-admin-list">{roleDefinitions.map((definition) => {
    const value = values[definition.role];
    const defaults = defaultTypographyValues()[definition.role];
    const css = cssFor(value);
    return <div className="ui-kit-admin-card" key={definition.role}><div className="ui-kit-admin-heading"><div><Text variant="headline">{definition.label}</Text><Text variant="footnote" tone="muted">{definition.usage}</Text></div><Text variant="caption" tone="muted">{definition.role}</Text></div><div className="ui-kit-admin-preview" style={typographyStyle(value)}>Пример типографики · {definition.label}</div><div className="ui-kit-admin-fields"><NumberField label="Size" value={value.size} min={12} max={48} onChange={(size) => onChange({ ...values, [definition.role]: { ...value, size } })} /><NumberField label="Line height" value={value.lineHeight} min={12} max={56} onChange={(lineHeight) => onChange({ ...values, [definition.role]: { ...value, lineHeight } })} /><label className="ui-kit-admin-field"><Text variant="footnote" className="ui-kit-admin-field-label">Weight</Text><select value={value.weight} onChange={(event) => onChange({ ...values, [definition.role]: { ...value, weight: Number(event.currentTarget.value) } })}><option value="400">Regular · 400</option><option value="500">Medium · 500</option><option value="600">Semibold · 600</option><option value="700">Bold · 700</option></select></label></div><pre className="ui-kit-admin-code"><code>{css}</code></pre><CopyActions css={css} onReset={() => onChange({ ...values, [definition.role]: defaults })} /></div>;
  })}</div>;
}

export function ComponentTypographySettings({ slots, assignments, onChange }: { slots: readonly TypographySlot[]; assignments: TypographyAssignments; onChange: (assignments: TypographyAssignments) => void }) {
  const defaults = Object.fromEntries(slots.map((slot) => [slot.id, slot.defaultRole])) as TypographyAssignments;
  const css = slots.map((slot) => `${slot.label}: ${assignments[slot.id] ?? slot.defaultRole};`).join('\n');
  return <details className="ui-kit-component-admin"><summary>Typography settings</summary><div className="ui-kit-component-admin__body">{slots.map((slot) => <label className="ui-kit-admin-field" key={slot.id}><Text variant="footnote" className="ui-kit-admin-field-label">{slot.label}</Text><select value={assignments[slot.id] ?? slot.defaultRole} onChange={(event) => onChange({ ...assignments, [slot.id]: event.currentTarget.value as TypographyRole })}>{roleDefinitions.map((role) => <option key={role.role} value={role.role}>{role.label}</option>)}</select></label>)}<pre className="ui-kit-admin-code"><code>{css}</code></pre><CopyActions css={css} onReset={() => onChange(defaults)} /></div></details>;
}
