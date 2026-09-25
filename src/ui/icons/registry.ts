import barbellFilledUrl from './liquid-glass-barbell-filled.svg';
import barbellOutlineUrl from './liquid-glass-barbell-outline.svg';
import calendarEventFilledUrl from './liquid-glass-calendar-event-filled.svg';
import calendarEventOutlineUrl from './liquid-glass-calendar-event-outline.svg';
import chartDotsFilledUrl from './liquid-glass-chart-dots-2-filled.svg';
import chartDotsOutlineUrl from './liquid-glass-chart-dots-2-outline.svg';
import clipboardListFilledUrl from './liquid-glass-clipboard-list-filled.svg';
import clipboardListOutlineUrl from './liquid-glass-clipboard-list-outline.svg';
import settingsFilledUrl from './liquid-glass-settings-filled.svg';
import settingsOutlineUrl from './liquid-glass-settings-outline.svg';
import usersFilledUrl from './liquid-glass-users-filled.svg';
import usersOutlineUrl from './liquid-glass-users-outline.svg';

const uiIconRegistry = {
  barbell: { outline: barbellOutlineUrl, filled: barbellFilledUrl },
  'calendar-event': { outline: calendarEventOutlineUrl, filled: calendarEventFilledUrl },
  'chart-dots-2': { outline: chartDotsOutlineUrl, filled: chartDotsFilledUrl },
  'clipboard-list': { outline: clipboardListOutlineUrl, filled: clipboardListFilledUrl },
  settings: { outline: settingsOutlineUrl, filled: settingsFilledUrl },
  users: { outline: usersOutlineUrl, filled: usersFilledUrl },
} as const;

export type UiIconName = keyof typeof uiIconRegistry;
export type UiIconVariant = keyof (typeof uiIconRegistry)[UiIconName];

export function getUiIconAsset(name: UiIconName, variant: UiIconVariant): string {
  return uiIconRegistry[name][variant];
}
