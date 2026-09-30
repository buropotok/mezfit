declare module 'konsta/shared/utils' {
  export function cls(
    ...args: Array<string | null | undefined | false>
  ): string;

  export type KonstaPopoverPosition = {
    set: true;
    angleTop?: string;
    angleLeft?: string;
    anglePosition: 'top' | 'bottom' | 'left' | 'right';
    popoverTop: string;
    popoverLeft: string;
    popoverPosition:
      | 'top-left'
      | 'top-right'
      | 'middle-left'
      | 'middle-right'
      | 'bottom-left'
      | 'bottom-right';
  };

  export function calcPopoverPosition(options: {
    popoverEl: HTMLElement;
    targetEl: unknown;
    angleEl: HTMLElement | null;
    needsAngle: boolean;
    targetX?: number;
    targetY?: number;
    targetWidth?: number;
    targetHeight?: number;
    theme: 'ios' | 'material';
  }): KonstaPopoverPosition;

  export function useIosHighlight(options: {
    getEl: () => HTMLElement | null;
    enabled?: boolean | (() => boolean);
    data?: Record<string, unknown>;
  }): {
    attachEvents: () => void;
    detachEvents: () => void;
    removeHoverHighlight: () => void;
  };
}

declare module 'konsta/shared/colors' {
  type DarkClassResolver = (classNames: string) => string;

  export type KonstaDialogColors = {
    bgIos: string;
    bgMaterial: string;
    titleIos: string;
    titleMaterial: string;
    contentTextIos: string;
    contentTextMaterial: string;
  };

  export type KonstaPanelColors = {
    bgIos: string;
    bgMaterial: string;
    floatingBgIos: string;
    floatingBgMaterial: string;
  };

  export type KonstaPopoverColors = {
    bgIos: string;
    bgMaterial: string;
  };

  export function DialogColors(
    colorsProp: unknown,
    dark: DarkClassResolver,
  ): KonstaDialogColors;

  export function PanelColors(
    colorsProp: unknown,
    dark: DarkClassResolver,
  ): KonstaPanelColors;

  export function PopoverColors(
    colorsProp: unknown,
    dark: DarkClassResolver,
  ): KonstaPopoverColors;
}

declare module 'konsta/shared/classes' {
  import type {
    KonstaDialogColors,
    KonstaPanelColors,
    KonstaPopoverColors,
  } from 'konsta/shared/colors';

  type ThemedClass = {
    common: string;
    ios?: string;
    material?: string;
  };

  type StatefulThemedClass = ThemedClass & {
    opened: ThemedClass;
    closed: ThemedClass;
  };

  export type KonstaDialogClassMap = {
    base: ThemedClass & {
      opened: string;
      closed: string;
    };
    contentWrap: ThemedClass;
    title: ThemedClass;
    content: ThemedClass;
    buttons: ThemedClass;
    backdrop: {
      common: string;
      opened: string;
      closed: string;
    };
  };

  export type KonstaPanelClassMap = {
    base: ThemedClass;
    left: {
      common: string;
      ios?: string;
      material?: string;
      opened: string;
      closed: string;
    };
    right: {
      common: string;
      ios?: string;
      material?: string;
      opened: string;
      closed: string;
    };
    backdrop: {
      common: string;
      opened: string;
      closed: string;
    };
  };

  export type KonstaPopoverClassMap = {
    base: StatefulThemedClass;
    inner: StatefulThemedClass;
    angleWrap: ThemedClass & {
      top: string;
      bottom: string;
      left: string;
      right: string;
    };
    angleArrow: ThemedClass & {
      top: string;
      bottom: string;
      left: string;
      right: string;
    };
    backdrop: {
      common: string;
      opened: string;
      closed: string;
    };
  };

  export function DialogClasses(
    props: object,
    colors: KonstaDialogColors,
  ): KonstaDialogClassMap;

  export function PanelClasses(
    props: object,
    colors: KonstaPanelColors,
  ): KonstaPanelClassMap;

  export function PopoverClasses(
    props: object,
    colors: KonstaPopoverColors,
    dark: (classNames: string) => string,
  ): KonstaPopoverClassMap;
}
