import {
  Fragment,
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type MouseEventHandler,
  type PointerEventHandler,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import { GlassSurface, type GlassBezelHighlights } from './GlassSurface';
import { Icon, type UiIconName, type UiIconVariant } from './Icon';
import type { GlassMaterialOverrides, GlassPresetName } from './glassMaterial';
import { Avatar, Text } from './primitives';
import './identity-action.css';

export type IdentityActionAvatar = {
  name: string;
  src?: string;
};

type IdentityActionVisual =
  | { avatar: IdentityActionAvatar; icon?: never; iconVariant?: never; iconSize?: never }
  | {
      avatar?: never;
      icon: UiIconName;
      iconVariant?: UiIconVariant;
      iconSize?: CSSProperties['width'];
    }
  | { avatar?: never; icon?: never; iconVariant?: never; iconSize?: never };

export type IdentityActionItem = {
  icon: UiIconName;
  iconVariant?: UiIconVariant;
  iconSize?: CSSProperties['width'];
  /** Optional icon revealed during the existing capsule press animation. */
  iconSwapTo?: UiIconName;
  label: string;
  'aria-expanded'?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  renderControl?: (control: ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>) => ReactNode;
};

export type IdentityActionTitleRole = 'body' | 'headline';

type IdentityActionBaseProps = {
  surfaceRef?: Ref<HTMLElement>;
  glassPreset?: GlassPresetName;
  glassOptics?: boolean;
  glass?: GlassMaterialOverrides;
  glassBezelOpacity?: number;
  glassBezelHighlights?: GlassBezelHighlights;
  disabled?: boolean;
};

type IdentityActionSingleProps = IdentityActionBaseProps & IdentityActionVisual & {
  title: string;
  variant?: 'labeled' | 'single' | 'default' | 'avatar-only';
  onClick?: () => void;
  actions?: never;
  'aria-label'?: string;
  width?: CSSProperties['width'];
  titleRole?: IdentityActionTitleRole;
  /** Hide a decorative icon only when the full label would overflow. Never hides an avatar. */
  autoHideIcon?: boolean;
};

type IdentityActionDoubleProps = IdentityActionBaseProps & {
  variant: 'double';
  actions: readonly [IdentityActionItem, IdentityActionItem];
  avatar?: never;
  icon?: never;
  title?: never;
  onClick?: never;
  'aria-label'?: never;
};

export type IdentityActionProps = IdentityActionSingleProps | IdentityActionDoubleProps;

const IdentityGlassButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ 'aria-disabled': ariaDisabled, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      {...props}
      aria-disabled={ariaDisabled}
      disabled={ariaDisabled === true || ariaDisabled === 'true'}
    />
  ),
);

IdentityGlassButton.displayName = 'IdentityGlassButton';

export function IdentityAction(props: IdentityActionProps) {
  const {
    variant = 'labeled',
    glassPreset,
    glassOptics = false,
    glass,
    glassBezelOpacity = 1,
    glassBezelHighlights,
    disabled = false,
  } = props;
  const [isAnimating, setIsAnimating] = useState(false);
  const [iconSwapIndex, setIconSwapIndex] = useState<number | null>(null);
  const [hideDecorativeIcon, setHideDecorativeIcon] = useState(false);
  const iconVisualRef = useRef<HTMLSpanElement>(null);
  const textMeasureRef = useRef<HTMLSpanElement>(null);
  const canHideIcon = props.variant !== 'double'
    && props.autoHideIcon === true
    && !!props.icon
    && (props.variant === undefined || props.variant === 'labeled' || props.variant === 'default');
  const measuredTitle = props.variant === 'double' ? undefined : props.title;
  const measuredRole = props.variant === 'double' ? undefined : props.titleRole;
  const rootRef = useRef<HTMLElement>(null);
  const surfaceRef = props.surfaceRef;
  const setSurfaceRef = useCallback((element: HTMLElement | null) => {
    rootRef.current = element;
    if (typeof surfaceRef === 'function') surfaceRef(element);
    else if (surfaceRef) surfaceRef.current = element;
  }, [surfaceRef]);
  const animationActiveRef = useRef(false);
  const pointerPressRef = useRef(false);
  const animationFinishedRef = useRef(false);
  const pendingActionRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    if (!canHideIcon) {
      setHideDecorativeIcon(false);
      return undefined;
    }

    const root = rootRef.current;
    const visual = iconVisualRef.current;
    const probe = textMeasureRef.current;
    if (!root || !visual || !probe) return undefined;

    const measure = () => {
      const rootWidth = root.clientWidth;
      const naturalTextWidth = Math.max(probe.scrollWidth, probe.getBoundingClientRect().width);
      if (!rootWidth || !naturalTextWidth) return;

      const style = getComputedStyle(root);
      const visualStyle = getComputedStyle(visual);
      const left = Number.parseFloat(style.paddingLeft) || 0;
      const right = Number.parseFloat(style.paddingRight) || 0;
      const gap = Number.parseFloat(style.columnGap) || 0;
      const iconSlotWidth = Number.parseFloat(visualStyle.width) || visual.offsetWidth;
      const availableWithIcon = rootWidth - left - right - gap - iconSlotWidth;

      // Always compare against the space WITH the icon: measuring the current
      // truncated title after hiding would make the icon flicker on/off.
      setHideDecorativeIcon(naturalTextWidth > availableWithIcon + 0.5);
    };

    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure);
      observer.observe(root);
      observer.observe(probe);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [canHideIcon, measuredTitle, measuredRole]);

  const finishActivation = useCallback(() => {
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    pointerPressRef.current = false;
    animationFinishedRef.current = false;
    setIconSwapIndex(null);
    if (!disabled) action?.();
  }, [disabled]);

  const finishAnimation = useCallback(() => {
    animationActiveRef.current = false;
    setIsAnimating(false);
    animationFinishedRef.current = pointerPressRef.current;

    if (pendingActionRef.current) finishActivation();
  }, [finishActivation]);

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return undefined;

    const handleAnimationEnd = (event: AnimationEvent) => {
      if (event.target === element) finishAnimation();
    };

    element.addEventListener('animationend', handleAnimationEnd);
    return () => element.removeEventListener('animationend', handleAnimationEnd);
  }, [finishAnimation]);

  const startAnimation = (fromPointer: boolean) => {
    if (disabled || animationActiveRef.current) return;

    animationActiveRef.current = true;
    animationFinishedRef.current = false;
    if (fromPointer) pointerPressRef.current = true;
    setIsAnimating(true);
  };

  const handlePointerDown: PointerEventHandler<HTMLElement> = (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    startAnimation(true);
  };

  const cancelPointerActivation = () => {
    if (pendingActionRef.current) return;
    pointerPressRef.current = false;
    animationFinishedRef.current = false;
    setIconSwapIndex(null);
  };

  const queueActivation = (action?: () => void, swapIndex?: number) => {
    if (disabled || !action || pendingActionRef.current) return;
    if (swapIndex !== undefined) setIconSwapIndex(swapIndex);

    if (animationActiveRef.current) {
      pendingActionRef.current = action;
      return;
    }

    if (pointerPressRef.current && animationFinishedRef.current) {
      pendingActionRef.current = action;
      finishActivation();
      return;
    }

    pendingActionRef.current = action;
    startAnimation(false);
  };

  const centerTitle = (variant === 'labeled' || variant === 'default')
    && props.variant !== 'double'
    && ((!props.icon && !props.avatar) || (canHideIcon && hideDecorativeIcon));
  const className = [
    'ui-identity-action',
    centerTitle ? 'ui-identity-action--title-centered' : '',
    variant === 'double' ? 'ui-identity-action--double' : '',
    variant === 'labeled' || variant === 'default' ? 'ui-identity-action--labeled' : '',
    variant === 'single' || variant === 'avatar-only' ? 'ui-identity-action--single' : '',
    variant === 'avatar-only' ? 'ui-identity-action--avatar-only' : '',
    disabled ? 'ui-identity-action--disabled' : '',
    isAnimating ? 'ui-identity-action--animating' : '',
  ].filter(Boolean).join(' ');

  if (props.variant === 'double') {
    return (
      <GlassSurface
        ref={setSurfaceRef}
        preset={glassPreset}
        optics={glassOptics}
        glass={glass}
        bezelOpacity={glassBezelOpacity}
        bezelHighlights={glassBezelHighlights}
        wrapContent={false}
        className={className}
        onPointerDown={handlePointerDown}
        onPointerCancel={cancelPointerActivation}
        onPointerLeave={cancelPointerActivation}
      >
        {props.actions.map((action, index) => {
          const swapping = iconSwapIndex === index && action.iconSwapTo !== undefined;
          const control = (
            <button
              className={[
                'ui-identity-action__segment',
                swapping && isAnimating ? 'ui-identity-action__segment--icon-swapping' : '',
                swapping && !isAnimating ? 'ui-identity-action__segment--icon-swapped' : '',
              ].filter(Boolean).join(' ')}
              type="button"
              aria-label={action.label}
              aria-expanded={action['aria-expanded']}
              disabled={disabled || action.disabled}
              onPointerDown={(event) => {
                if (event.pointerType === 'mouse' && event.button !== 0) return;
                if (!disabled && !action.disabled) setIconSwapIndex(action.iconSwapTo ? index : null);
              }}
              onClick={() => queueActivation(action.onClick, action.iconSwapTo ? index : undefined)}
            >
              <Icon
                className="ui-identity-action__segment-icon"
                name={action.icon}
                variant={action.iconVariant ?? 'filled'}
                style={action.iconSize === undefined ? undefined : { width: action.iconSize, height: action.iconSize }}
              />
              {action.iconSwapTo && <Icon
                className="ui-identity-action__segment-swap-icon"
                name={action.iconSwapTo}
                variant={action.iconVariant ?? 'filled'}
                style={action.iconSize === undefined ? undefined : { width: action.iconSize, height: action.iconSize }}
              />}
            </button>
          );

          return (
            <Fragment key={index}>
              {action.renderControl ? action.renderControl(control) : control}
            </Fragment>
          );
        })}
      </GlassSurface>
    );
  }

  const {
    avatar,
    icon,
    iconVariant,
    iconSize,
    title,
    titleRole,
    onClick,
    width,
    'aria-label': ariaLabel,
  } = props;
  const handleClick: MouseEventHandler<HTMLElement> = () => queueActivation(onClick);
  const showTitle = variant !== 'single' && variant !== 'avatar-only';

  return (
    <GlassSurface
      component={IdentityGlassButton}
      ref={setSurfaceRef}
      preset={glassPreset}
      optics={glassOptics}
      glass={glass}
      bezelOpacity={glassBezelOpacity}
      bezelHighlights={glassBezelHighlights}
      wrapContent={false}
      className={className}
      aria-label={ariaLabel ?? title}
      aria-disabled={disabled || undefined}
      style={width === undefined ? undefined : { width, minWidth: width, maxWidth: width }}
      onPointerDown={handlePointerDown}
      onPointerCancel={cancelPointerActivation}
      onPointerLeave={cancelPointerActivation}
      onClick={handleClick}
    >
      {(icon || avatar) && <span
        ref={iconVisualRef}
        className="ui-identity-action__visual"
        aria-hidden="true"
        style={canHideIcon && hideDecorativeIcon ? { display: 'none' } : undefined}
      >
        {icon ? (
          <Icon
            className="ui-identity-action__icon"
            name={icon}
            variant={iconVariant ?? 'outline'}
            style={{
              width: iconSize ?? (variant === 'labeled' || variant === 'default' ? 32 : 36),
              height: iconSize ?? (variant === 'labeled' || variant === 'default' ? 32 : 36),
            }}
          />
        ) : avatar ? (
          <Avatar
            className="ui-identity-action__avatar"
            name={avatar.name}
            src={avatar.src}
          />
        ) : null}
      </span>}
      {showTitle && <Text variant={titleRole ?? 'body'} className="ui-identity-action__title">{title}</Text>}
      {canHideIcon && <span ref={textMeasureRef} className="ui-identity-action__title-measure" aria-hidden="true">
        <Text variant={titleRole ?? 'body'}>{title}</Text>
      </span>}
    </GlassSurface>
  );
}
