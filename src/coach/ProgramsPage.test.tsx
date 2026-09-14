import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProgramsPage } from './ProgramsPage';

describe('ProgramsPage', () => {
  it('renders the coach program controls while data is loading', () => {
    const html = renderToStaticMarkup(
      <ProgramsPage
        initData="test-init-data"
        creationDraft={null}
        creationBusy={false}
        creationError=""
        refreshKey={0}
        onOpenCreation={vi.fn()}
        onCancelCreation={vi.fn()}
        onDraftChange={vi.fn()}
        onRequestClientSelection={vi.fn()}
        onSaveCreation={vi.fn()}
      />,
    );

    expect(html).toContain('Поиск клиента');
    expect(html).toContain('Активные');
    expect(html).toContain('Завершённые');
    expect(html).toContain('Черновики');
    expect(html).toContain('Загружаем программы');
    expect(html).toContain('aria-label="Создать программу"');
  });
});
