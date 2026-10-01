import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type MouseEventHandler,
  type PointerEventHandler,
} from 'react';
import { GlassSurface } from './GlassSurface';
import { Icon, type UiIconName } from './Icon';
import { Avatar } from './primitives';
import './identity-action.css';

export type IdentityActionAvatar = {
  name: string;
  src?: string;
};

type IdentityActionVisual =
  | { avatar: IdentityActionAvatar; icon?: never }
  | { avatar?: never; icon: UiIconName };

export type IdentityActionProps = IdentityActionVisual & {
  title: string;
  variant?: 'default' | 'avatar-only';
  onClick?: () => void;
  disabled?: boolean;
  'aria-label'?: string;
};

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

export function IdentityAction({
  avatar,
  icon,
  title,
  variant = 'default',
  onClick,
  disabled = false,
  'aria-label': ariaLabel,
}: IdentityActionProps) {
  const [isAnimating, setIsAnimating] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const animationActiveRef = useRef(false);
  const pointerPressRef = useRef(false);
  const animationFinishedRef = useRef(false);
  const activationQueuedRef = useRef(false);

  const finishActivation = useCallback(() => {
    activationQueuedRef.current = false;
    pointerPressRef.current = false;
    animationFinishedRef.current = false;
    if (!disabled) onClick?.();
  }, [disabled, onClick]);

  const finishAnimation = useCallback(() => {
    animationActiveRef.current = false;
    setIsAnimating(false);
    animationFinishedRef.current = pointerPressRef.current;

    if (activationQueuedRef.current) finishActivation();
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
    if (activationQueuedRef.current) return;
    pointerPressRef.current = false;
    animationFinishedRef.current = false;
  };

  const handleClick: MouseEventHandler<HTMLElement> = () => {
    if (disabled || !onClick || activationQueuedRef.current) return;

    if (animationActiveRef.current) {
      activationQueuedRef.current = true;
      return;
    }

    if (pointerPressRef.current && animationFinishedRef.current) {
      finishActivation();
      return;
    }

    activationQueuedRef.current = true;
    startAnimation(false);
  };

  return (
    <GlassSurface
      component={IdentityGlassButton}
      ref={rootRef}
      wrapContent={false}
      className={`ui-identity-action${variant === 'avatar-only' ? ' ui-identity-action--avatar-only' : ''}${disabled ? ' ui-identity-action--disabled' : ''}${isAnimating ? ' ui-identity-action--animating' : ''}`}
      aria-label={ariaLabel ?? title}
      aria-disabled={disabled || undefined}
      onPointerDown={handlePointerDown}
      onPointerCancel={cancelPointerActivation}
      onPointerLeave={cancelPointerActivation}
      onClick={handleClick}
    >
      <span className="ui-identity-action__visual" aria-hidden="true">
        {icon ? (
          <Icon className="ui-identity-action__icon" name={icon} variant="filled" />
        ) : avatar ? (
          <Avatar
            className="ui-identity-action__avatar"
            name={avatar.name}
            src={avatar.src}
          />
        ) : null}
      </span>
      {variant === 'default' && <span className="ui-identity-action__title">{title}</span>}
    </GlassSurface>
  );
}
