import { Divider, NestedBadges, Surface, Text } from './index';
import { TypographySpecimen } from './TypographySpecimen';
import type { TypographySlot, TypographyValues } from './TypographyAdmin';

const nestedBadgeSlots: TypographySlot[] = [
  { id: 'badge', label: 'Текст бейджа', defaultRole: 'body', selector: '.ui-nested-badges .ui-badge' },
  { id: 'info', label: 'Инф.', defaultRole: 'body', selector: '.ui-nested-badges__info' },
];

const demoItems = [
  {
    id: 'coach',
    label: 'Тренер · Алексей',
    color: 'green' as const,
    info: 'Инф.',
    children: [{
      id: 'program',
      label: 'Программа · Сила',
      color: 'blue' as const,
      info: 'Инф.',
      children: [{
        id: 'phase',
        label: 'Фаза · База',
        color: 'yellow' as const,
        info: 'Инф.',
        children: [{
          id: 'day',
          label: 'День · 1',
          color: 'purple' as const,
          info: 'Инф.',
          children: [
            { id: 'squat', label: 'Присед', color: 'cyan' as const, info: 'Инф.' },
            { id: 'bench', label: 'Жим лёжа', color: 'cyan' as const, info: 'Инф.' },
          ],
        }],
      }],
    }],
  },
];

export function NestedBadgesCatalog({ values }: { values: TypographyValues }) {
  return (
    <Surface as="section" className="ui-kit-section">
      <Text variant="title">Nested badges</Text>
      <Text variant="caption" tone="muted">Иерархическая группа существующих Badge с интерактивным раскрытием уровней.</Text>
      <Divider />
      <TypographySpecimen kind="list" slots={nestedBadgeSlots} values={values}>
        <NestedBadges items={demoItems} />
      </TypographySpecimen>
    </Surface>
  );
}
