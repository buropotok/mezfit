// Konsta 5.4.0 Mezfit edition: preserve Searchbar mechanics; replace only Konsta Glass with GlassSurface.
import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ElementType,
  type FocusEvent,
  type FormEvent,
  type PointerEvent,
} from 'react';
import {
  Searchbar as KonstaSearchbar,
  useTheme,
  useThemeClasses,
} from 'konsta/react';
import { SearchbarClasses } from 'konsta/shared/classes';
import { SearchbarColors } from 'konsta/shared/colors';
import { cls } from 'konsta/shared/utils';
import { GlassSurface } from '../GlassSurface';
import type { GlassPresetName } from '../glassMaterial';

export type MezfitSearchbarProps = ComponentProps<typeof KonstaSearchbar> & {
  glassPreset?: GlassPresetName;
  glassOptics?: boolean;
};

const canonicalDark = (classNames: string) => classNames;

function SearchIcon({
  theme,
  className,
}: {
  theme: 'ios' | 'material';
  className?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={theme === 'ios' ? 13 : 48}
      height={theme === 'ios' ? 13 : 48}
      viewBox="0 0 56 56"
      fill="currentcolor"
      className={className}
      aria-hidden="true"
    >
      <path d="M 23.9570 41.7695 C 27.8476 41.7695 31.4804 40.5039 34.4336 38.3945 L 45.5429 49.5039 C 46.0585 50.0195 46.7382 50.2774 47.4414 50.2774 C 48.9648 50.2774 50.0664 49.1055 50.0664 47.6055 C 50.0664 46.9023 49.8322 46.2461 49.3162 45.7305 L 38.2773 34.6679 C 40.5976 31.6211 41.9804 27.8476 41.9804 23.7461 C 41.9804 13.8320 33.8710 5.7226 23.9570 5.7226 C 14.0195 5.7226 5.9336 13.8320 5.9336 23.7461 C 5.9336 33.6601 14.0195 41.7695 23.9570 41.7695 Z M 23.9570 37.8789 C 16.1992 37.8789 9.8242 31.4805 9.8242 23.7461 C 9.8242 16.0117 16.1992 9.6133 23.9570 9.6133 C 31.6914 9.6133 38.0898 16.0117 38.0898 23.7461 C 38.0898 31.4805 31.6914 37.8789 23.9570 37.8789 Z" />
    </svg>
  );
}

function SearchDisableIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 56 56"
      fill="currentcolor"
      aria-hidden="true"
    >
      <path d="M 10.0234 43.0234 C 9.2266 43.8203 9.2031 45.1797 10.0234 45.9766 C 10.8438 46.7734 12.1797 46.7734 13.0000 45.9766 L 28.0000 30.9766 L 43.0000 45.9766 C 43.7969 46.7734 45.1563 46.7969 45.9766 45.9766 C 46.7734 45.1562 46.7734 43.8203 45.9766 43.0234 L 30.9531 28.0000 L 45.9766 13.0000 C 46.7734 12.2031 46.7969 10.8437 45.9766 10.0469 C 45.1328 9.2266 43.7969 9.2266 43.0000 10.0469 L 28.0000 25.0469 L 13.0000 10.0469 C 12.1797 9.2266 10.8203 9.2031 10.0234 10.0469 L 25.0234 28.0000 Z" />
    </svg>
  );
}

function DeleteIcon({
  theme,
  className,
}: {
  theme: 'ios' | 'material';
  className?: string;
}) {
  return theme === 'ios' ? (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 56 56"
      fill="currentcolor"
      className={className}
      aria-hidden="true"
    >
      <path d="M 28 51.9062 C 41.0781 51.9062 51.9062 41.0547 51.9062 28 C 51.9062 14.9219 41.0547 4.0938 27.9766 4.0938 C 14.9219 4.0938 4.0938 14.9219 4.0938 28 C 4.0938 41.0547 14.9453 51.9062 28 51.9062 Z M 19.2109 39.25 C 17.9453 39.25 16.9609 38.2656 16.9609 37 C 16.9609 36.4141 17.1953 35.875 17.6172 35.4531 L 25.0703 28 L 17.6172 20.5469 C 17.1953 20.125 16.9609 19.5625 16.9609 19 C 16.9609 17.7344 17.9453 16.75 19.2109 16.75 C 19.7969 16.75 20.3359 16.9609 20.7578 17.3828 L 28.2109 24.8594 L 35.7109 17.3594 C 36.1562 16.9141 36.6719 16.7031 37.2578 16.7031 C 38.5234 16.7031 39.5078 17.6875 39.5078 18.9531 C 39.5078 19.5391 39.2969 20.0547 38.8516 20.5 L 31.375 28 L 38.8281 35.4297 C 39.25 35.875 39.4844 36.3906 39.4844 36.9766 C 39.4844 38.2422 38.5 39.2266 37.2344 39.2266 C 36.6484 39.2266 36.1328 39.0156 35.6875 38.5703 L 28.2109 31.1172 L 20.7578 38.5703 C 20.3359 39.0156 19.7969 39.25 19.2109 39.25 Z" />
    </svg>
  ) : (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="currentcolor"
      className={className}
      aria-hidden="true"
    >
      <path d="M18.3 5.71 12 12l6.3 6.29-1.42 1.42L10.59 13.41 4.29 19.71 2.88 18.3 9.17 12 2.88 5.71 4.29 4.29 10.59 10.59 16.88 4.29z" />
    </svg>
  );
}

function BackIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentcolor"
      className={className}
      aria-hidden="true"
    >
      <polygon points="16 7 3.83 7 9.42 1.41 8 0 0 8 8 16 9.41 14.59 3.83 9 16 9" />
    </svg>
  );
}

export function MezfitSearchbar(props: MezfitSearchbarProps) {
  const {
    component = 'div',
    className,
    colors: colorsProp,
    placeholder = 'Search',
    value,
    inputId,
    inputStyle,

    disableButton = false,
    clearButton = true,

    onInput,
    onChange,
    onFocus,
    onBlur,
    onClear,
    onDisable,

    ios,
    material,

    glassPreset = 'frosted',
    glassOptics = false,

    ref,
    ...rest
  } = props;

  const searchElRef = useRef<HTMLInputElement | null>(null);
  const elRef = useRef<HTMLElement | null>(null);
  const disableTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isEnabled, setIsEnabled] = useState(false);
  const theme = useTheme({ ios, material });
  const themeClasses = useThemeClasses({ ios, material });
  const colors = SearchbarColors(colorsProp, canonicalDark);

  const handleInput = (event: FormEvent<HTMLInputElement>) => {
    onInput?.(event);
  };

  const handleChange = (event: FormEvent<HTMLInputElement>) => {
    onChange?.(event);
  };

  const handleFocus = (event: FocusEvent<HTMLInputElement>) => {
    setIsEnabled(true);
    onFocus?.(event);
  };

  const handleBlur = (event: FocusEvent<HTMLInputElement>) => {
    onBlur?.(event);
  };

  const onGlobalBlur = () => {
    if (!value) {
      disableTimeout.current = setTimeout(() => {
        setIsEnabled(false);
      });
    }
  };

  const onGlobalFocus = () => {
    if (disableTimeout.current !== null) clearTimeout(disableTimeout.current);
  };

  useEffect(() => () => {
    if (disableTimeout.current !== null) clearTimeout(disableTimeout.current);
  }, []);

  const handleDisableButton = (event: PointerEvent<HTMLButtonElement> | React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setIsEnabled(false);
    searchElRef.current?.blur();
    onDisable?.();
    onClear?.(event);
  };

  const c = themeClasses(
    SearchbarClasses({ ...props }, colors, {
      isEnabled,
      darkClasses: canonicalDark,
    }),
  );

  const Component = component as ElementType;
  const setRootRef = (element: HTMLElement | null) => {
    elRef.current = element;
    if (typeof ref === 'function') ref(element);
    else if (ref) ref.current = element;
  };

  const cancelButton = theme === 'ios' ? (
    <GlassSurface
      component="button"
      type="button"
      ref={undefined}
      style={{
        marginRight: isEnabled ? 0 : `-${48 + 16}px`,
        marginLeft: isEnabled ? '16px' : 0,
      }}
      className={cls('k-glass touch-none', c.cancelButton)}
      preset={glassPreset}
      optics={glassOptics}
      wrapContent={false}
      onClick={handleDisableButton}
      onPointerDown={(event) => event.preventDefault()}
    >
      <SearchDisableIcon />
    </GlassSurface>
  ) : (
    <button
      type="button"
      className={cls(c.cancelButton)}
      onClick={handleDisableButton}
      onPointerDown={(event) => event.preventDefault()}
    >
      <BackIcon />
    </button>
  );

  return (
    <Component
      ref={setRootRef}
      className={cls(c.base, className)}
      {...rest}
      onBlurCapture={onGlobalBlur}
      onFocusCapture={onGlobalFocus}
    >
      <GlassSurface
        className={cls('k-glass touch-none', c.inner)}
        preset={glassPreset}
        optics={glassOptics}
        wrapContent={false}
      >
        <span className={c.searchIconWrap}>
          <SearchIcon theme={theme} className={c.searchIcon} />
        </span>
        <input
          id={inputId}
          ref={searchElRef}
          className={cls(c.input)}
          style={inputStyle}
          type="text"
          name="search"
          placeholder={String(placeholder)}
          value={value}
          onInput={handleInput}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
        />
        {value && clearButton ? (
          <button className={c.clearButton} onClick={onClear} type="button">
            <DeleteIcon theme={theme} className={c.deleteIcon} />
          </button>
        ) : null}
      </GlassSurface>
      {disableButton ? cancelButton : null}
    </Component>
  );
}

MezfitSearchbar.displayName = 'MezfitSearchbar';
