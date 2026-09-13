import { useState, type CSSProperties, type ReactNode } from 'react';
import { ComponentTypographySettings, type TypographyAssignments, type TypographyRole, type TypographySlot, type TypographyValues } from './TypographyAdmin';

type Kind = 'buttons' | 'search' | 'avatar' | 'tabs' | 'list' | 'sortable-list';
type TypographyVars = CSSProperties & Record<string, string | number>;

export function typographyVariables(slots: readonly TypographySlot[], assignments: TypographyAssignments, values: TypographyValues): TypographyVars {
  const style: TypographyVars = {};
  for (const slot of slots) {
    const role: TypographyRole = assignments[slot.id] ?? slot.defaultRole;
    const value = values[role];
    style[`--ui-kit-slot-${slot.id}-size`] = `${value.size}px`;
    style[`--ui-kit-slot-${slot.id}-line`] = `${value.lineHeight}px`;
    style[`--ui-kit-slot-${slot.id}-weight`] = slot.weightOverride ?? value.weight;
  }
  return style;
}

export function typographyValueStyle(role: TypographyRole, values: TypographyValues): CSSProperties {
  const value = values[role];
  return { fontFamily: 'var(--ui-font-family)', fontSize: `${value.size}px`, lineHeight: `${value.lineHeight}px`, fontWeight: value.weight };
}

export function TypographySpecimen({ kind, slots, values, children }: { kind: Kind; slots: readonly TypographySlot[]; values: TypographyValues; children: ReactNode }) {
  const defaults = Object.fromEntries(slots.map((slot) => [slot.id, slot.defaultRole])) as TypographyAssignments;
  const [assignments, setAssignments] = useState<TypographyAssignments>(defaults);
  return <div className={`ui-kit-type-scope ui-kit-type-scope--${kind}`} style={typographyVariables(slots, assignments, values)}>{children}<ComponentTypographySettings slots={slots} assignments={assignments} values={values} onChange={setAssignments} /></div>;
}
