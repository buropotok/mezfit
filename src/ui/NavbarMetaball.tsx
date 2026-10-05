import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { GlassContourBezel, GlassSurface } from './GlassSurface';
import { IdentityAction, type IdentityActionAvatar } from './IdentityAction';
import type { UiIconName } from './Icon';
import type { GlassMaterialOverrides, GlassPresetName } from './glassMaterial';
import { smoothFab } from './fabMetaballGeometry';
import {
  NAVBAR_METABALL,
  navbarBackReveal,
  navbarIdentityWidth,
  navbarMetaballBezelHighlights,
  navbarMetaballContour,
  navbarMetaballFrame,
  navbarMetaballRupture,
  type NavbarMetaballLayout,
} from './navbarMetaballGeometry';
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

const TRANSPARENT_GLASS: GlassMaterialOverrides = Object.freeze({
  tintA: 0,
  blur: 0,
  saturation: 1,
  brightness: 1,
  bezel: 0,
  border: 0,
  shadow: 0,
  rimStrength: 0,
  trenchStrength: 0,
  refraction: 0,
});

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
    width: 390,
    identityWidth: navbarIdentityWidth(390),
  });

  const target = level === 2 ? 1 : 0;
  const moving = time !== target;
  const atIdentity = !moving && target === 0;
  const atLevelTwo = !moving && target === 1;
  const rupture = useMemo(() => navbarMetaballRupture(layout), [layout]);
  const geometry = useMemo(
    () => navbarMetaballFrame(time, layout, rupture),
    [time, layout, rupture],
  );
  const contour = useMemo(() => navbarMetaballContour(geometry), [geometry]);
  const backReveal = navbarBackReveal(time, rupture);

  useLayoutEffect(() => {
    const element = rootRef.current;
    if (!element) return undefined;

    const measure = () => {
      const width = element.offsetWidth || element.getBoundingClientRect().width || 390;
      const identityWidth = navbarIdentityWidth(width);
      setLayout(current => (
        Math.abs(current.width - width) < 0.5
        && Math.abs(current.identityWidth - identityWidth) < 0.5
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

  const movingGlass = moving ? TRANSPARENT_GLASS : undefined;
  const movingOptics = moving ? false : glassOptics;

  return (
    <div
      ref={rootRef}
      className="ui-navbar-metaball"
      data-level={level}
      data-moving={moving || undefined}
    >
      {moving ? (
        <GlassSurface
          className="ui-navbar-metaball__liquid"
          preset={glassPreset}
          bezelOpacity={0}
          contour={contour}
          shape={{ radius: 0 }}
        />
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
        {identity.icon ? (
          <IdentityAction
            variant="labeled"
            icon={identity.icon}
            iconVariant="outline"
            iconSize={32}
            title={identity.title}
            titleRole="headline"
            width="100%"
            glassPreset={glassPreset}
            glassOptics={movingOptics}
            glass={movingGlass}
            glassBezelOpacity={bezelReveal}
            onClick={onIdentityClick}
          />
        ) : (
          <IdentityAction
            variant="labeled"
            avatar={identity.avatar}
            title={identity.title}
            titleRole="headline"
            width="100%"
            glassPreset={glassPreset}
            glassOptics={movingOptics}
            glass={movingGlass}
            glassBezelOpacity={bezelReveal}
            onClick={onIdentityClick}
          />
        )}
      </div>

      <div
        className="ui-mezfit-navbar__side--left ui-navbar-metaball__back-slot"
        aria-hidden={!atLevelTwo || undefined}
        style={{
          ...shapeStyle(geometry.day),
          opacity: backReveal,
          visibility: atIdentity ? 'hidden' : 'visible',
          pointerEvents: atLevelTwo ? 'auto' : 'none',
        }}
      >
        <IdentityAction
          variant="single"
          icon="chevron-left"
          iconVariant="outline"
          iconSize={32}
          title="Назад"
          aria-label="Назад"
          glassPreset={glassPreset}
          glassOptics={atLevelTwo ? glassOptics : false}
          glass={movingGlass}
          glassBezelOpacity={bezelReveal}
          onClick={atLevelTwo ? onBack : undefined}
        />
      </div>
    </div>
  );
}
