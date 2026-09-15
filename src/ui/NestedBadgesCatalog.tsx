import { Divider, NestedBadges, Surface, Text } from './index';
import { TypographySpecimen } from './TypographySpecimen';
import type { TypographySlot, TypographyValues } from './TypographyAdmin';

const nestedBadgeSlots: TypographySlot[] = [
  { id: 'badge', label: 'Текст бейджа', defaultRole: 'body', selector: '.ui-nested-badges .ui-badge' },
  { id: 'info', label: 'Вспомогательная информация', defaultRole: 'caption', selector: '.ui-nested-badges__info' },
];

const demoItems = [
  {
    id: 'training',
    label: 'Тренировка',
    color: 'blue' as const,
    info: 'Основная группа',
    children: [
      { id: 'strength', label: 'Силовая', color: 'green' as const, info: '3 программы' },
      {
        id: 'mobility',
        label: 'Мобильность',
        color: 'purple' as const,
        children: [{ id: 'shoulders', label: 'Плечи', color: 'orange' as const, info: '6 упражнений' }],
      },
    ],
  },
  { id: 'recovery', label: 'Восстановление', color: 'cyan' as const, info: '2 программы' },
];

export function NestedBadgesCatalog({ values }: { values: TypographyValues }) {
  return (
    <Surface as="section" className="ui-kit-section">
      <Text variant="title">Nested badges</Text>
      <Text variant="caption" tone="muted">Иерархическая группа существующих Badge без собственной бизнес-семантики.</Text>
      <Divider />
      <TypographySpecimen kind="nested-badges" slots={nestedBadgeSlots} values={values}>
        <NestedBadges items={demoItems} />
      </TypographySpecimen>
    </Surface>
  );
}
