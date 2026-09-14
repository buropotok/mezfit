import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProgramsPage } from './ProgramsPage';

describe('ProgramsPage', () => {
  it('renders program controls while data is loading', () => {
    const html = renderToStaticMarkup(<ProgramsPage initData="test-init-data" />);

    expect(html).toContain('Поиск клиента');
    expect(html).toContain('Активные');
    expect(html).toContain('Завершённые');
    expect(html).toContain('Черновики');
    expect(html).toContain('Загружаем программы');
  });
});
