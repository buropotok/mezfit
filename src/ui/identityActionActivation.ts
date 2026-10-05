import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEventHandler,
  type Ref,
} from 'react';

export function useIdentityActionActivation({
  disabled = false,
  externalRef,
}: {
  disabled?: boolean;
  externalRef?: Ref<HTMLElement>;
} = {}) {
  const [isAnimating, setIsAnimating] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const animationActiveRef = useRef(false);
  const pointerPressRef = useRef(false);
  const animationFinishedRef = useRef(false);
  const pendingActionRef = useRef<(() => void) | null>(null);

  const setRootRef = useCallback((element: HTMLElement | null) => {
    rootRef.current = element;
    if (typeof externalRef === 'function') externalRef(element);
    else if (externalRef) externalRef.current = element;
  }, [externalRef]);

  const finishActivation = useCallback(() => {
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    pointerPressRef.current = false;
    animationFinishedRef.current = false;
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
  };

  const queueActivation = (action?: () => void) => {
    if (disabled || !action || pendingActionRef.current) return;

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

  return {
    isAnimating,
    setRootRef,
    handlePointerDown,
    cancelPointerActivation,
    queueActivation,
  };
}
