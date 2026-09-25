import type { ReactElement } from 'react';
import type { UiIconName } from './icons/registry';

export type UiIconPair = {
  outline: ReactElement;
  filled: ReactElement;
};

export type UiIconSource = UiIconName | UiIconPair;
