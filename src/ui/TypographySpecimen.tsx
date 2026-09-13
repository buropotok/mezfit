import { useState, type CSSProperties, type ReactNode } from 'react';
import { ComponentTypographySettings, type TypographyAssignments, type TypographyRole, type TypographySlot, type TypographyValues } from './TypographyAdmin';

type Kind = 'buttons' | 'search' | 'avatar' | 'menu' | 'tabs' | 'dropdown' | 'list' | 'sortable-list';

type RoleVars = CSSProperties & Record<`--ui-kit-role-${TypographyRole}-${'size' | 'line' | 'weight'}`, string | number>;

export function roleVariables(values: TypographyValues): RoleVars {
  const style = {} as RoleVars;
  for (const [role, value] of Object.entries(values) as Array<[TypographyRole, TypographyValues[TypographyRole]]>) {
    style[`--ui-kit-role-${role}-size`] = `${value.size}px`;
    style[`--ui-kit-role-${role}-line`] = `${value.lineHeight}px`;
    style[`--ui-kit-role-${role}-weight`] = value.weight;
  }
  return style;
}

export function roleClass(slot: string, role: TypographyRole) { return `ui-kit-${slot}-role-${role}`; }

export function TypographySpecimen({ kind, slots, values, children }: { kind: Kind; slots: readonly TypographySlot[]; values: TypographyValues; children: ReactNode }) {
  const defaults = Object.fromEntries(slots.map((slot) => [slot.id, slot.defaultRole])) as TypographyAssignments;
  const [assignments, setAssignments] = useState<TypographyAssignments>(defaults);
  const data = Object.fromEntries(slots.map((slot) => [`data-${slot.id}-role`, assignments[slot.id] ?? slot.defaultRole]));
  return <div className={`ui-kit-type-scope ui-kit-type-scope--${kind}`} style={roleVariables(values)} {...data}>{children}<ComponentTypographySettings slots={slots} assignments={assignments} onChange={setAssignments} /></div>;
}
