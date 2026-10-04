// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Badge } from './Badge';
import { Dropdown } from './Dropdown';
import { Checkbox, TextInput } from './FormControls';
import { SearchInput } from './SearchInput';
import { ListItem } from './components';
import { Button } from './primitives';

afterEach(() => cleanup());

describe('shared semantic typography consumers', () => {
  it('delegates shared app-owned text to semantic preset classes', () => {
    const view = render(
      <>
        <Button>Сохранить</Button>
        <TextInput label="Название" value="Тест" onChange={() => undefined} />
        <Checkbox label="Активно" />
        <Badge>Статус</Badge>
        <ListItem
          interactive={false}
          title="Основной текст"
          subtitle="Подпись"
          trailing="Значение"
        />
        <SearchInput value="Поиск" onChange={() => undefined} />
        <Dropdown
          mode="single"
          value="one"
          options={[{ value: 'one', label: 'Один' }]}
          onChange={() => undefined}
        />
      </>,
    );

    expect(view.getByRole('button', { name: 'Сохранить' }).classList.contains('ui-text--body')).toBe(true);
    expect(view.getByLabelText('Название').classList.contains('ui-text--body')).toBe(true);
    expect(view.getByText('Название').classList.contains('ui-text--caption')).toBe(true);
    expect(view.getByText('Активно').classList.contains('ui-text--body')).toBe(true);
    expect(view.getByText('Статус').classList.contains('ui-text--body')).toBe(true);
    expect(view.getByText('Основной текст').classList.contains('ui-text--body')).toBe(true);
    expect(view.getByText('Подпись').classList.contains('ui-text--footnote')).toBe(true);
    expect(view.getByText('Значение').classList.contains('ui-text--footnote')).toBe(true);
    expect(view.getByRole('searchbox').classList.contains('ui-text--body')).toBe(true);
    expect(view.getByRole('button', { name: 'Один' }).classList.contains('ui-text--body')).toBe(true);
  });
});
