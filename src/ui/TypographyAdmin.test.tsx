import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ComponentTypographySettings, TypographyRoleAdmin, defaultTypographyValues, roleDefinitions, type TypographyAssignments, type TypographySlot } from './TypographyAdmin';

describe('UI Kit typography admin', () => {
  it('labels every shared typography role and exposes copy/reset controls', () => {
    const values = defaultTypographyValues();
    const html = renderToStaticMarkup(<TypographyRoleAdmin values={values} onChange={() => undefined} />);
    for (const label of ['Large title', 'Title', 'Headline', 'Body', 'Footnote', 'Caption']) expect(html).toContain(label);
    expect(html).toContain('Main screen title');
    expect(html).toContain('Modal title / important compact heading');
    expect(html.match(/Copy CSS/g)?.length).toBe(6);
    expect(html.match(/Reset/g)?.length).toBe(6);
  });

  it('offers only shared roles for semantic slots and renders copyable CSS', () => {
    const slots: TypographySlot[] = [
      { id: 'title', label: 'Заголовок', defaultRole: 'headline', selector: '.ui-modal__title' },
      { id: 'body', label: 'Основной текст', defaultRole: 'body', selector: '.ui-modal__content' },
      { id: 'buttons', label: 'Кнопки', defaultRole: 'body', selector: '.ui-modal__action', weightOverride: 500 },
    ];
    const assignments: TypographyAssignments = { title: 'headline', body: 'body', buttons: 'body' };
    const html = renderToStaticMarkup(<ComponentTypographySettings slots={slots} assignments={assignments} values={defaultTypographyValues()} onChange={() => undefined} />);
    expect(html).toContain('Typography settings');
    for (const slot of slots) expect(html).toContain(slot.label);
    for (const role of roleDefinitions) expect(html).toContain(`value="${role.role}"`);
    expect(html).not.toContain('type="number"');
    expect(html).toContain('.ui-modal__title');
    expect(html).toContain('font-size: 17px');
    expect(html).toContain('font-weight: 500');
    expect(html).toContain('Copy CSS');
    expect(html).toContain('Reset');
  });
});
