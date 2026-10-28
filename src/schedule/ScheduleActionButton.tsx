import { forwardRef, useEffect, useRef } from 'react';
import { GlassSurface, Icon } from '../ui';
import { startSpringScale } from '../ui/SpringScale';

/** Shared calendar actions: identical glass, size and press feedback. */
export const ScheduleActionButton = forwardRef<HTMLButtonElement, {
  icon: 'search' | 'trash';
  label: string;
  pressed?: boolean;
  onClick: () => void;
}>(function ScheduleActionButton({ icon, label, pressed, onClick }, ref) {
  const button = useRef<HTMLButtonElement | null>(null);
  const previousPressed = useRef(pressed);
  const animation = useRef<Animation | undefined>(undefined);
  useEffect(() => {
    if (pressed !== previousPressed.current && button.current) {
      animation.current = startSpringScale(button.current);
    }
    previousPressed.current = pressed;
  }, [pressed]);
  useEffect(() => () => animation.current?.cancel(), []);
  return <button type="button" className="today-page__search-button" aria-label={label}
    aria-pressed={pressed} onClick={onClick} ref={element => {
      button.current = element;
      if (typeof ref === 'function') ref(element);
      else if (ref) ref.current = element;
    }}>
    <GlassSurface preset="modalTuned" shape="capsule" className="today-page__search-glass" wrapContent={false}>
      <span className={`today-page__action-icon${pressed ? ' today-page__action-icon--active' : ''}`}>
        <Icon name={icon} style={{ width: 24, height: 24 }} />
      </span>
    </GlassSurface>
  </button>;
});
