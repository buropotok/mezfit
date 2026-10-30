// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { FlexAttributesRepository } from '../data/cloud/flex-attributes';
import { ResistanceBandsSettings } from './ResistanceBandsSettings';

const repoState = vi.hoisted(() => ({ getValues: vi.fn(), setValues: vi.fn() }));
const cloudState = vi.hoisted(() => ({ sync: vi.fn() }));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: vi.fn() }));
vi.mock('../data/cloud/flex-attributes', () => ({
  FlexAttributesRepository: vi.fn().mockImplementation(() => repoState),
}));
vi.mock('../ui', () => ({
  Text: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
    <span role={typeof props.role === 'string' ? props.role : undefined}>{children}</span>,
  Button: ({ children, onClick, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) =>
    <button onClick={onClick} disabled={props.disabled} aria-label={props['aria-label']}>{children}</button>,
  GlassSurface: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  RangePicker: ({ onChange }: { onChange: (range: { min: number; max: number }) => void }) =>
    <button onClick={() => onChange({ min: 3, max: 8 })}>Колесо диапазона</button>,
  GlassBackgroundColorControls: ({ onChange }: { onChange: (color: { hue: number; saturation: number; value: number }) => void }) =>
    <button onClick={() => onChange({ hue: 210, saturation: 80, value: 90 })}>Цветовое колесо</button>,
}));

const database = { cloud: { sync: cloudState.sync } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useCloudConnections).mockReturnValue({
    db: database, actorUserId: 'tg:42',
  } as unknown as NonNullable<ReturnType<typeof useCloudConnections>>);
  repoState.getValues.mockResolvedValue([]);
  repoState.setValues.mockResolvedValue(undefined);
  cloudState.sync.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); });

describe('five fitness bands settings connected to personal Flex EAV', () => {
  it('renders the real settings for a verified user and persists modified range', async () => {
    render(<ResistanceBandsSettings />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Изменить диапазон ленты 1' }).hasAttribute('disabled')).toBe(false));
    expect(screen.getByText('2–5 кг')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Изменить диапазон ленты 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Колесо диапазона' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить ленты' }));
    await waitFor(() => expect(screen.getByText('Настройки отправлены в Dexie Cloud.')).toBeTruthy());
    expect(FlexAttributesRepository).toHaveBeenCalledWith(database, 'tg:42');
    expect(repoState.setValues).toHaveBeenCalledWith(
      { entityType: 'user', entityId: 'tg:42', realmId: 'tg:42' },
      [{ key: 'Band_1_min', valueType: 'number', value: 3 },
       { key: 'Band_1_max', valueType: 'number', value: 8 }],
    );
    expect(cloudState.sync).toHaveBeenCalledWith({ purpose: 'push', wait: true });
  });

  it('never claims cloud persistence when the push fails', async () => {
    cloudState.sync.mockImplementation(async (request: { purpose: string }) => {
      if (request.purpose === 'push') throw new Error('private token');
    });
    render(<ResistanceBandsSettings />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Изменить диапазон ленты 1' }).hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Изменить диапазон ленты 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Колесо диапазона' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить ленты' }));
    await waitFor(() => expect(screen.getByText('Ожидается синхронизация.')).toBeTruthy());
    expect(document.body.textContent).not.toContain('private token');
    expect(document.body.textContent).not.toContain('Настройки отправлены в Dexie Cloud.');
  });

  it('shows defaults but disables saving without an authenticated cloud identity', () => {
    vi.mocked(useCloudConnections).mockReturnValue(null);
    render(<ResistanceBandsSettings />);
    expect((screen.getByRole('button', { name: 'Сохранить ленты' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('2–5 кг')).toBeTruthy();
    expect(repoState.setValues).not.toHaveBeenCalled();
  });
});
