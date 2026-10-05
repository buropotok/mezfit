import {
  Fragment,
  forwardRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import { GlassSurface } from './GlassSurface';
import { Icon, type UiIconName, type UiIconVariant } from './Icon';
import type { GlassPresetName } from './glassMaterial';
import { useIdentityActionActivation } from './identityActionActivation';
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
    };

export type IdentityActionItem = {
  icon: UiIconName;
  iconVariant?: UiIconVariant;
  iconSize?: CSSProperties['width'];
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  renderControl?: (control: ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>) => ReactNode;
};

export type IdentityActionTitleRole = 'body' | 'headline';

type IdentityActionBaseProps = {
  surfaceRef?: Ref<HTMLElement>;
  glassPreset?: GlassPresetName;
  glassOptics?: boolean;
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
    disabled = false,
  } = props;
  const {
    isAnimating,
    setRootRef: setSurfaceRef,
    handlePointerDown,
    cancelPointerActivation,
    queueActivation,
  } = useIdentityActionActivation({
    disabled,
    externalRef: props.surfaceRef,
  });

  const className = [
    'ui-identity-action',
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
        wrapContent={false}
        className={className}
        onPointerDown={handlePointerDown}
        onPointerCancel={cancelPointerActivation}
        onPointerLeave={cancelPointerActivation}
      >
        {props.actions.map((action) => {
          const control = (
            <button
              className="ui-identity-action__segment"
              type="button"
              aria-label={action.label}
              disabled={disabled || action.disabled}
              onClick={() => queueActivation(action.onClick)}
            >
              <Icon
                className="ui-identity-action__segment-icon"
                name={action.icon}
                variant={action.iconVariant ?? 'filled'}
                style={action.iconSize === undefined ? undefined : { width: action.iconSize, height: action.iconSize }}
              />
            </button>
          );

          return (
            <Fragment key={action.label}>
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
  const showTitle = variant !== 'single' && variant !== 'avatar-only';

  return (
    <GlassSurface
      component={IdentityGlassButton}
      ref={setSurfaceRef}
      preset={glassPreset}
      optics={glassOptics}
      wrapContent={false}
      className={className}
      aria-label={ariaLabel ?? title}
      aria-disabled={disabled || undefined}
      style={width === undefined ? undefined : { width, minWidth: width, maxWidth: width }}
      onPointerDown={handlePointerDown}
      onPointerCancel={cancelPointerActivation}
      onPointerLeave={cancelPointerActivation}
      onClick={() => queueActivation(onClick)}
    >
      <span className="ui-identity-action__visual" aria-hidden="true">
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
      </span>
      {showTitle && <Text variant={titleRole ?? 'body'} className="ui-identity-action__title">{title}</Text>}
    </GlassSurface>
  );
}
