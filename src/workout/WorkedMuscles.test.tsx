import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkedMuscles } from './WorkedMuscles';

describe('WorkedMuscles presentation contract', () => {
  it('renders both views and only the two visibility toggles, without editing controls', () => {
    const html = renderToStaticMarkup(
      <WorkedMuscles
        primaryMuscleIds={['latissimus_dorsi']}
        secondaryMuscleIds={['rhomboids', 'forearm_grip']}
      />,
    );

    expect(html).toContain('Вид спереди');
    expect(html).toContain('Вид сзади');
    expect(html).toContain('Основные');
    expect(html).toContain('Вспомогательные');
    expect((html.match(/type="checkbox"/g) ?? []).length).toBe(2);
    expect(html).not.toContain('Загрузить');
    expect(html).not.toContain('Скачать');
  });
});
