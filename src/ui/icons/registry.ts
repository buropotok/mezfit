import arrowLeftUrl from './arrow-left.svg';
import barbellFilledUrl from './liquid-glass-barbell-filled.svg';
import barbellOutlineUrl from './liquid-glass-barbell-outline.svg';
import calendarFilledUrl from './calendar-filled.svg';
import calendarOutlineUrl from './liquid-glass-calendar-outline.svg';
import calendarEventFilledUrl from './liquid-glass-calendar-event-filled.svg';
import calendarEventOutlineUrl from './liquid-glass-calendar-event-outline.svg';
import chartDotsFilledUrl from './liquid-glass-chart-dots-2-filled.svg';
import chartDotsOutlineUrl from './liquid-glass-chart-dots-2-outline.svg';
import chevronLeftUrl from './chevron-left.svg';
import clipboardListFilledUrl from './liquid-glass-clipboard-list-filled.svg';
import clipboardListOutlineUrl from './liquid-glass-clipboard-list-outline.svg';
import clockUrl from './clock.svg';
import dotsVerticalUrl from './dots-vertical.svg';
import homeFilledUrl from './home-filled.svg';
import homeUrl from './home.svg';
import infoCircleUrl from './info-circle.svg';
import menu2Url from './menu-2.svg';
import plusOutlineUrl from './plus-outline.svg';
import textPlusUrl from './text-plus.svg';
import userPlusUrl from './user-plus.svg';
import settingsFilledUrl from './liquid-glass-settings-filled.svg';
import settingsOutlineUrl from './liquid-glass-settings-outline.svg';
import usersFilledUrl from './liquid-glass-users-filled.svg';
import usersOutlineUrl from './liquid-glass-users-outline.svg';

const uiIconRegistry = {
  'arrow-left': { outline: arrowLeftUrl, filled: arrowLeftUrl },
  barbell: { outline: barbellOutlineUrl, filled: barbellFilledUrl },
  calendar: { outline: calendarOutlineUrl, filled: calendarFilledUrl },
  'calendar-event': { outline: calendarEventOutlineUrl, filled: calendarEventFilledUrl },
  'chart-dots-2': { outline: chartDotsOutlineUrl, filled: chartDotsFilledUrl },
  'chevron-left': { outline: chevronLeftUrl, filled: chevronLeftUrl },
  'clipboard-list': { outline: clipboardListOutlineUrl, filled: clipboardListFilledUrl },
  clock: { outline: clockUrl, filled: clockUrl },
  'dots-vertical': { outline: dotsVerticalUrl, filled: dotsVerticalUrl },
  home: { outline: homeUrl, filled: homeFilledUrl },
  'info-circle': { outline: infoCircleUrl, filled: infoCircleUrl },
  'menu-2': { outline: menu2Url, filled: menu2Url },
  plus: { outline: plusOutlineUrl, filled: plusOutlineUrl },
  'text-plus': { outline: textPlusUrl, filled: textPlusUrl },
  'user-plus': { outline: userPlusUrl, filled: userPlusUrl },
  settings: { outline: settingsOutlineUrl, filled: settingsFilledUrl },
  users: { outline: usersOutlineUrl, filled: usersFilledUrl },
} as const;

export type UiIconName = keyof typeof uiIconRegistry;
export type UiIconVariant = keyof (typeof uiIconRegistry)[UiIconName];

export function getUiIconAsset(name: UiIconName, variant: UiIconVariant): string {
  return uiIconRegistry[name][variant];
}
