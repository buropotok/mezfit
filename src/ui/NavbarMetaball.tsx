import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { GlassContourBezel, GlassSurface } from './GlassSurface';
import { Icon, type UiIconName } from './Icon';
import type { IdentityActionAvatar } from './IdentityAction';
import { useIdentityActionActivation } from './identityActionActivation';
import type { GlassPresetName } from './glassMaterial';
import { Avatar, Text } from './primitives';
import {
  NAVBAR_METABALL,
  navbarBackReveal,
  navbarMetaballBezelHighlights,
  navbarMetaballContour,
  navbarMetaballFrame,
  navbarMetaballGeometry,
  navbarMetaballRupture,
  type NavbarMetaballLayout,
} from './navbarMetaballGeometry';
import { smoothFab } from './fabMetaballGeometry';
import './identity-action.css';
import './NavbarMetaball.css';

export type NavbarMetaballIdentity =
  | { title: string; icon: UiIconName; avatar?: never }
  | { title: string; avatar: IdentityActionAvatar; icon?: never };

type NavbarMetaballProps = {
  level: 1 | 2;
  identity: NavbarMetaballIdentity;
  onBack: () => void;
  onIdentityClick?: () => void;
  glassPreset?: GlassPresetName;
  glassOptics?: boolean;
};

const shapeStyle = (shape: { x: number; y: number; width: number; height: number }): CSSProperties => ({
  left: shape.x - shape.width / 2,
  top: shape.y - shape.height / 2,
  width: shape.width,
  height: shape.height,
});

function scheduleFrame(callback: FrameRequestCallback) {
  if (typeof window.requestAnimationFrame === 'function') return window.requestAnimationFrame(callback);
  return window.setTimeout(() => callback(performance.now()), 16);
}

function cancelFrame(frame: number) {
  if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(frame);
  else window.clearTimeout(frame);
}

export function NavbarMetaball({
  level,
  identity,
  onBack,
  onIdentityClick,
  glassPreset,
  glassOptics = false,
}: NavbarMetaballProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef(0);
  const progressRef = useRef(level === 2 ? 1 : 0);
  const wasMovingRef = useRef(false);
  const [time, setTime] = useState(level === 2 ? 1 : 0);
  const [bezelReveal, setBezelReveal] = useState(1);
  const [layout, setLayout] = useState<NavbarMetaballLayout>({
    width: 320,
    identityWidth: 156,
  });
  const target = level === 2 ? 1 : 0;
  const rupture = useMemo(() => navbarMetaballRupture(layout), [layout]);
  const geometry = useMemo(() => navbarMetaballFrame(time, layout, rupture), [time, layout, rupture]);
  const finalGeometry = useMemo(() => navbarMetaballGeometry(1, layout), [layout]);
  const contour = useMemo(() => navbarMetaballContour(geometry), [geometry]);
  const atIdentity = time === 0;
  const atLevelTwo = time === 1;
  const moving = !atIdentity && !atLevelTwo;
  const backReveal = navbarBackReveal(time, rupture);
  const centralActivation = useIdentityActionActivation();
  const backActivation = useIdentityActionActivation();

  useLayoutEffect(() => {
    const element = rootRef.current;
    if (!element) return undefined;

    const measure = () => {
      const width = element.offsetWidth || element.getBoundingClientRect().width || 320;
      const identityWidth = Math.max(44, Math.min(224, width - 164));
      setLayout(current => (
        Math.abs(current.width - width) < 0.5 && Math.abs(current.identityWidth - identityWidth) < 0.5
          ? current
          : { width, identityWidth }
      ));
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    cancelFrame(frameRef.current);
    const from = progressRef.current;
    if (from === target) {
      setTime(target);
      return undefined;
    }

    const view = rootRef.current?.ownerDocument.defaultView;
    if (view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      progressRef.current = target;
      setTime(target);
      return undefined;
    }

    const duration = NAVBAR_METABALL.duration * Math.abs(target - from);
    let started: number | undefined;
    const tick = (now: number) => {
      started ??= now;
      const fraction = Math.min(1, (now - started) / duration);
      const value = from + (target - from) * fraction;
      progressRef.current = value;
      setTime(value);
      if (fraction < 1) frameRef.current = scheduleFrame(tick);
    };

    frameRef.current = scheduleFrame(tick);
    return () => cancelFrame(frameRef.current);
  }, [target]);

  useLayoutEffect(() => {
    const revealAfterMotion = wasMovingRef.current;
    wasMovingRef.current = moving;

    if (!moving && !revealAfterMotion) return undefined;
    if (moving) {
      setBezelReveal(0);
      return undefined;
    }

    const view = rootRef.current?.ownerDocument.defaultView;
    if (view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setBezelReveal(1);
      return undefined;
    }

    let revealFrame = 0;
    let started: number | undefined;
    const reveal = (now: number) => {
      started ??= now;
      const value = Math.min(1, (now - started) / NAVBAR_METABALL.bezelRevealDuration);
      setBezelReveal(smoothFab(value));
      if (value < 1) revealFrame = scheduleFrame(reveal);
    };

    setBezelReveal(0);
    revealFrame = scheduleFrame(reveal);
    return () => cancelFrame(revealFrame);
  }, [moving]);

  const centralClassName = [
    'ui-identity-action',
    'ui-identity-action--labeled',
    'ui-navbar-metaball__control',
    'ui-navbar-metaball__control--identity',
    centralActivation.isAnimating ? 'ui-identity-action--animating' : '',
  ].filter(Boolean).join(' ');
  const backClassName = [
    'ui-identity-action',
    'ui-identity-action--single',
    'ui-navbar-metaball__control',
    'ui-navbar-metaball__control--back',
    backActivation.isAnimating ? 'ui-identity-action--animating' : '',
  ].filter(Boolean).join(' ');
  const centralSurfaceClassName = [
    'ui-navbar-metaball__surface',
    'ui-navbar-metaball__surface--identity',
    centralActivation.isAnimating ? 'ui-identity-action--animating' : '',
  ].filter(Boolean).join(' ');
  const backSurfaceClassName = [
    'ui-navbar-metaball__surface',
    'ui-navbar-metaball__surface--back',
    backActivation.isAnimating ? 'ui-identity-action--animating' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={rootRef}
      className="ui-navbar-metaball"
      data-level={level}
      data-moving={moving || undefined}
    >
      {atIdentity ? (
        <GlassSurface
          className={centralSurfaceClassName}
          preset={glassPreset}
          optics={glassOptics}
          bezelOpacity={bezelReveal}
          shape="capsule"
          style={shapeStyle(geometry.phase)}
        />
      ) : null}

      {moving ? (
        <GlassSurface
          className="ui-navbar-metaball__liquid"
          preset={glassPreset}
          bezelOpacity={0}
          contour={contour}
          shape={{ radius: 0 }}
        />
      ) : null}

      {atLevelTwo ? (
        <>
          <GlassSurface
            className={centralSurfaceClassName}
            preset={glassPreset}
            optics={glassOptics}
            bezelOpacity={bezelReveal}
            shape="capsule"
            style={shapeStyle(finalGeometry.phase)}
          />
          <GlassSurface
            className={backSurfaceClassName}
            preset={glassPreset}
            optics={glassOptics}
            bezelOpacity={bezelReveal}
            shape="capsule"
            style={shapeStyle(finalGeometry.day)}
          />
        </>
      ) : null}

      {(moving || bezelReveal < 1) ? (
        <div className="ui-navbar-metaball__liquid">
          <GlassContourBezel
            contour={contour}
            highlights={navbarMetaballBezelHighlights(geometry, time, rupture)}
            preset={glassPreset}
            opacity={moving ? 1 : 1 - bezelReveal}
          />
        </div>
      ) : null}

      <div
        className="ui-mezfit-navbar__identity ui-navbar-metaball__identity-slot"
        style={shapeStyle(geometry.phase)}
      >
        <button
          ref={centralActivation.setRootRef}
          type="button"
          className={centralClassName}
          aria-label={identity.title}
          style={{ width: '100%', minWidth: '100%', maxWidth: '100%' }}
          onPointerDown={centralActivation.handlePointerDown}
          onPointerCancel={centralActivation.cancelPointerActivation}
          onPointerLeave={centralActivation.cancelPointerActivation}
          onClick={() => centralActivation.queueActivation(onIdentityClick)}
        >
          <span className="ui-identity-action__visual" aria-hidden="true">
            {identity.icon ? (
              <Icon
                className="ui-identity-action__icon"
                name={identity.icon}
                variant="outline"
                style={{ width: 32, height: 32 }}
              />
            ) : (
              <Avatar
                className="ui-identity-action__avatar"
                name={identity.avatar.name}
                src={identity.avatar.src}
              />
            )}
          </span>
          <Text variant="headline" className="ui-identity-action__title">{identity.title}</Text>
        </button>
      </div>

      <div
        className="ui-mezfit-navbar__side--left ui-navbar-metaball__back-slot"
        aria-hidden={!atLevelTwo || undefined}
        style={{
          ...shapeStyle(geometry.day),
          opacity: backReveal,
          pointerEvents: atLevelTwo ? 'auto' : 'none',
        }}
      >
        <button
          ref={backActivation.setRootRef}
          type="button"
          className={backClassName}
          aria-label="Назад"
          onPointerDown={backActivation.handlePointerDown}
          onPointerCancel={backActivation.cancelPointerActivation}
          onPointerLeave={backActivation.cancelPointerActivation}
          onClick={() => backActivation.queueActivation(level === 2 ? onBack : undefined)}
        >
          <span className="ui-identity-action__visual" aria-hidden="true">
            <Icon
              className="ui-identity-action__icon"
              name="chevron-left"
              variant="outline"
              style={{ width: 32, height: 32 }}
            />
          </span>
        </button>
      </div>
    </div>
  );
}
