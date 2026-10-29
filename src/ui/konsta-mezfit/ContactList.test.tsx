// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ListItem } from 'konsta/react';
import { MezfitContactList, MezfitContactListGroup } from './ContactList';

afterEach(cleanup);

describe('MezfitContactList', () => {
  it('renders transparent alphabet headers with a white rule and retains Konsta contact rows', () => {
    render(<MezfitContactList>
      <MezfitContactListGroup title="А">
        <ListItem contacts title="Андрей Соколов" />
      </MezfitContactListGroup>
      <MezfitContactListGroup title="Б">
        <ListItem contacts title="Борис Петров" />
      </MezfitContactListGroup>
    </MezfitContactList>);

    const header = screen.getByText('А', { selector: 'li' });
    expect(header.className).toContain('bg-transparent');
    expect(header.className).not.toContain('bg-ios-dark-surface-variant');
    expect(header.className).toContain('sticky');

    const rule = header.querySelector('span[aria-hidden="true"]');
    expect(rule?.classList.contains('bg-white')).toBe(true);
    expect(screen.getByText('Б', { selector: 'li' })).toBeTruthy();
    expect(screen.getByText('Андрей Соколов')).toBeTruthy();
    expect(screen.getByText('Борис Петров')).toBeTruthy();
  });
});
