// Konsta 5.4.0 Mezfit edition: preserve Searchbar mechanics; replace only Konsta Glass with GlassSurface.
import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type ComponentProps,
  type ElementType,
  type FocusEvent,
  type FormEvent,
  type MouseEvent,
  type PointerEvent,
  type SVGProps,
} from 'react';
import {
  Searchbar as KonstaSearchbar,
  useTheme,
} from 'konsta/react';
import { SearchbarClasses } from 'konsta/shared/classes';
import { SearchbarColors } from 'konsta/shared/colors';
import { cls, useIosHighlight } from 'konsta/shared/utils';
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
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="currentcolor"
      className={className}
      aria-hidden="true"
    >
      <path d="M14,0 C21.7319865,0 28,6.2680135 28,14 C28,21.7319865 21.7319865,28 14,28 C6.2680135,28 0,21.7319865 0,14 C0,6.2680135 6.2680135,0 14,0 Z M18.9393398,6.93933983 L14,11.8786797 L9.06066017,6.93933983 L6.93933983,9.06066017 L11.8786797,14 L6.93933983,18.9393398 L9.06066017,21.0606602 L14,16.1213203 L18.9393398,21.0606602 L21.0606602,18.9393398 L16.1213203,14 L21.0606602,9.06066017 L18.9393398,6.93933983 Z" />
    </svg>
  ) : (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.47 2 2 6.47 2 12C2 17.53 6.47 22 12 22C17.53 22 22 17.53 22 12C22 6.47 17.53 2 12 2ZM12 20C7.59 20 4 16.41 4 12C4 7.59 7.59 4 12 4C16.41 4 20 7.59 20 12C20 16.41 16.41 20 12 20ZM12 10.59L15.59 7L17 8.41L13.41 12L17 15.59L15.59 17L12 13.41L8.41 17L7 15.59L10.59 12L7 8.41L8.41 7L12 10.59Z"
        fill="currentcolor"
      />
    </svg>
  );
}

const SearchbarGlassButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  (props, ref) => <button ref={ref} type="button" {...props} />,
);

SearchbarGlassButton.displayName = 'SearchbarGlassButton';

function BackIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentcolor"
      aria-hidden="true"
      {...props}
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

    glassPreset = 'frosted',
    glassOptics = false,

    ref,
    ...rest
  } = props;

  const searchElRef = useRef<HTMLInputElement | null>(null);
  const elRef = useRef<HTMLElement | null>(null);
  const innerGlassRef = useRef<HTMLElement | null>(null);
  const cancelGlassRef = useRef<HTMLElement | null>(null);
  const innerHighlightData = useRef<Record<string, unknown>>({});
  const cancelHighlightData = useRef<Record<string, unknown>>({});
  const disableTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isEnabled, setIsEnabled] = useState(false);
  const theme = useTheme();
  const colors = SearchbarColors(colorsProp, canonicalDark);
  const {
    attachEvents: attachInnerHighlight,
    detachEvents: detachInnerHighlight,
  } = useIosHighlight({
    getEl: () => innerGlassRef.current,
    enabled: theme === 'ios',
    data: innerHighlightData.current,
  });
  const {
    attachEvents: attachCancelHighlight,
    detachEvents: detachCancelHighlight,
  } = useIosHighlight({
    getEl: () => cancelGlassRef.current,
    enabled: theme === 'ios',
    data: cancelHighlightData.current,
  });

  const handleInput = (event: FormEvent<HTMLInputElement>) => {
    onInput?.(event);
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
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

  useEffect(() => {
    attachInnerHighlight();
    attachCancelHighlight();
    return () => {
      detachInnerHighlight();
      detachCancelHighlight();
    };
  });

  useEffect(() => () => {
    if (disableTimeout.current !== null) clearTimeout(disableTimeout.current);
  }, []);

  const handleDisableButton = (event: PointerEvent<Element> | MouseEvent<Element>) => {
    event.preventDefault();
    setIsEnabled(false);
    searchElRef.current?.blur();
    onDisable?.();
    onClear?.();
  };

  const c = SearchbarClasses({ ...props }, colors, {
    isEnabled,
    darkClasses: canonicalDark,
  });
  const themedClass = (entry: { common?: string; ios?: string; material?: string }) => (
    cls(entry[theme], entry.common)
  );

  const Component = component as ElementType;
  const setRootRef = (element: HTMLElement | null) => {
    elRef.current = element;
    if (typeof ref === 'function') ref(element);
    else if (ref) ref.current = element;
  };

  const cancelButton = theme === 'ios' ? (
    <GlassSurface
      component={SearchbarGlassButton}
      ref={cancelGlassRef}
      style={{
        marginRight: isEnabled ? 0 : `-${48 + 16}px`,
        marginLeft: isEnabled ? '16px' : 0,
      }}
      className={cls('k-glass touch-none', themedClass(c.cancelButton))}
      preset={glassPreset}
      optics={glassOptics}
      wrapContent={false}
      onClick={handleDisableButton}
      onPointerDown={(event) => event.preventDefault()}
    >
      <SearchDisableIcon />
    </GlassSurface>
  ) : (
    <BackIcon
      className={themedClass(c.cancelButton)}
      onClick={handleDisableButton}
      onPointerDown={(event) => event.preventDefault()}
    />
  );

  return (
    <Component
      ref={setRootRef}
      className={cls(themedClass(c.base), className)}
      {...rest}
      onBlurCapture={onGlobalBlur}
      onFocusCapture={onGlobalFocus}
    >
      <GlassSurface
        ref={innerGlassRef}
        className={cls('k-glass touch-none', themedClass(c.inner))}
        preset={glassPreset}
        optics={glassOptics}
        wrapContent={false}
      >
        <span className={themedClass(c.searchIconWrap)}>
          <SearchIcon theme={theme} className={themedClass(c.searchIcon)} />
        </span>
        <input
          id={inputId}
          ref={searchElRef}
          className={themedClass(c.input)}
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
          <button className={themedClass(c.clearButton)} onClick={onClear} type="button">
            <DeleteIcon theme={theme} className={themedClass(c.deleteIcon)} />
          </button>
        ) : null}
      </GlassSurface>
      {disableButton ? cancelButton : null}
    </Component>
  );
}

MezfitSearchbar.displayName = 'MezfitSearchbar';
