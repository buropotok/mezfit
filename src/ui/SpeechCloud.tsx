import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Text } from './primitives';
import { clamp, paintLiquidMesh, smooth } from './liquidPopoverCanvas';
import { paintLiquidPopoverText } from './liquidPopoverText';
import type { LiquidRect } from './liquidPopoverGeometry';
import {
  createSpeechCloudMotion, placeSpeechCloud, SPEECH_CLOUD_DEFAULTS,
  SPEECH_CLOUD_TEXT_RATIO, speechCloudAvatarScale, speechCloudBendSide,
  speechCloudDimPath, speechCloudTail, type SpeechCloudArea,
} from './speechCloudGeometry';
import './speech-cloud.css';

export interface SpeechCloudProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  text: string;
  /** Render the actual circular avatar here; this primitive owns only its wrapper. */
  avatar: ReactNode;
  maxWidth?: number;
  durationMs?: number;
  tailDurationMs?: number;
  /** Delay from the start of the entire opening, not from the body's completion. */
  tailDelayMs?: number;
  tailBend?: number;
  /** Optional viewport-coordinate area, e.g. below a Navbar. Intersected with safe areas. */
  availableArea?: SpeechCloudArea;
  label?: string;
}

type Session = {
  motion: ReturnType<typeof createSpeechCloudMotion>;
  rect: LiquidRect;
  texture: HTMLCanvasElement | null;
  side: number;
};

const finite = (value: number, fallback: number, min: number, max: number) =>
  Number.isFinite(value) ? clamp(value, min, max) : fallback;
const liquidRect = (rect: DOMRect): LiquidRect => ({
  x: rect.left + rect.width / 2, y: rect.top + rect.height / 2,
  w: rect.width, h: rect.height,
});

export function SpeechCloud({
  isOpen, onOpenChange, text, avatar, availableArea, label = 'Подсказка тренера',
  maxWidth = SPEECH_CLOUD_DEFAULTS.maxWidth,
  durationMs = SPEECH_CLOUD_DEFAULTS.durationMs,
  tailDurationMs = SPEECH_CLOUD_DEFAULTS.tailDurationMs,
  tailDelayMs = SPEECH_CLOUD_DEFAULTS.tailDelayMs,
  tailBend = SPEECH_CLOUD_DEFAULTS.tailBend,
}: SpeechCloudProps) {
  const [presented, setPresented] = useState(false);
  const active = isOpen && text.trim().length > 0;
  const visible = active || presented;
  const anchorRef = useRef<HTMLSpanElement>(null);
  const avatarRef = useRef<HTMLSpanElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<SVGPathElement>(null);
  const tailRef = useRef<SVGPathElement>(null);
  const dimRef = useRef<SVGPathElement>(null);
  const apertureRef = useRef<SVGPathElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const elapsedRef = useRef(0);
  const wasOpenRef = useRef(false);
  const pulseStartRef = useRef<number | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const displayedText = useRef(text);
  // Retain the departing text until reverse animation is complete.
  if (active || !presented) displayedText.current = text;
  const contentId = `speech-cloud-${useId().replace(/:/g, '')}`;
  const maskId = `${contentId}-avatar-mask`;
  const bodyMs = finite(durationMs, 400, 100, 4000);
  const tailMs = finite(tailDurationMs, 250, 100, 500);
  const delayMs = finite(tailDelayMs, 200, 0, 2000);
  const bend = finite(tailBend, 12, 0, 40);
  const widthLimit = finite(maxWidth, 300, 92, 1000);

  useLayoutEffect(() => {
    const anchor = anchorRef.current, animatedAvatar = avatarRef.current;
    const layer = layerRef.current, measure = measureRef.current;
    const content = contentRef.current, body = bodyRef.current;
    const tail = tailRef.current, dim = dimRef.current, canvas = canvasRef.current;
    const aperture = apertureRef.current;
    if (!visible || !anchor || !animatedAvatar || !layer || !measure || !content || !body || !tail || !dim || !canvas || !aperture) return;
    setPresented(true);
    let frame = 0, disposed = false, dirty = true;
    let lastTime = performance.now();
    const total = Math.max(bodyMs, delayMs + tailMs, 400);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const context = typeof CanvasRenderingContext2D === 'undefined' ? null : canvas.getContext('2d');
    if (active && (!wasOpenRef.current || pulseStartRef.current === null)) pulseStartRef.current = lastTime;
    wasOpenRef.current = active;
    const closeStarted = lastTime;
    const closeScale = pulseStartRef.current === null ? 1 : speechCloudAvatarScale(lastTime - pulseStartRef.current);

    const prepare = (): Session | null => {
      const source = liquidRect(anchor.getBoundingClientRect());
      if (!source.w || !source.h || !anchor.isConnected) return null;
      const viewport = layer.getBoundingClientRect(), style = getComputedStyle(layer);
      const left = viewport.left + (parseFloat(style.paddingLeft) || 0);
      const top = viewport.top + (parseFloat(style.paddingTop) || 0);
      const right = viewport.right - (parseFloat(style.paddingRight) || 0);
      const bottom = viewport.bottom - (parseFloat(style.paddingBottom) || 0);
      const safeLeft = Math.max(left, availableArea?.left ?? left);
      const safeTop = Math.max(top, availableArea?.top ?? top);
      const safeRight = Math.min(right, availableArea ? availableArea.left + availableArea.width : right);
      const safeBottom = Math.min(bottom, availableArea ? availableArea.top + availableArea.height : bottom);
      const area = { left: safeLeft, top: safeTop, width: safeRight - safeLeft, height: safeBottom - safeTop };
      if (area.width < 32 || area.height < 32) return null;
      measure.style.maxWidth = `${Math.min(widthLimit, area.width) * SPEECH_CLOUD_TEXT_RATIO}px`;
      const measured = measure.getBoundingClientRect();
      const rect = placeSpeechCloud(source,
        Math.max(92, measured.width / SPEECH_CLOUD_TEXT_RATIO),
        Math.max(70, measured.height / SPEECH_CLOUD_TEXT_RATIO), area);
      const textWidth = rect.w * SPEECH_CLOUD_TEXT_RATIO;
      const textHeight = rect.h * SPEECH_CLOUD_TEXT_RATIO;
      Object.assign(content.style, {
        left: `${rect.x - textWidth / 2}px`, top: `${rect.y - textHeight / 2}px`,
        width: `${textWidth}px`, height: `${textHeight}px`,
      });
      // Paint the actual semantic Text node after browser wrapping/positioning.
      // Content has no opening transform, so raster and live HTML share coordinates.
      const texture = layer.ownerDocument.createElement('canvas');
      texture.width = Math.max(1, Math.ceil(rect.w));
      texture.height = Math.max(1, Math.ceil(rect.h));
      const textureContext = context ? texture.getContext('2d') : null;
      const liveText = content.firstElementChild;
      let painted = false;
      if (textureContext && liveText instanceof HTMLElement) {
        // Preserve the live scroller's clipping during the raster handoff.
        textureContext.save();
        textureContext.beginPath();
        textureContext.rect((rect.w - textWidth) / 2, (rect.h - textHeight) / 2, textWidth, textHeight);
        textureContext.clip();
        painted = paintLiquidPopoverText(textureContext, liveText,
          { left: rect.x - rect.w / 2, top: rect.y - rect.h / 2 });
        textureContext.restore();
      }
      const motion = createSpeechCloudMotion(source, rect);
      canvas.width = Math.max(1, Math.ceil(viewport.right));
      canvas.height = Math.max(1, Math.ceil(viewport.bottom));
      return { motion, rect, texture: painted ? texture : null,
        side: speechCloudBendSide(motion.contour(motion.morphStart), source, rect) };
    };

    const draw = (now: number) => {
      const elapsed = elapsedRef.current, progress = clamp(elapsed / bodyMs);
      // Only this owned wrapper is transformed; the avatar component is untouched.
      const pulseTime = pulseStartRef.current === null ? 400 : now - pulseStartRef.current;
      const scale = active ? speechCloudAvatarScale(pulseTime)
        : 1 + (closeScale - 1) * (1 - smooth((now - closeStarted) / 100));
      animatedAvatar.style.transform = `scale(${reduced ? 1 : scale})`;
      const avatarBounds = liquidRect(animatedAvatar.getBoundingClientRect());
      if (dirty) {
        sessionRef.current = prepare();
        dirty = false;
      }
      const outsideAvatar = speechCloudDimPath(canvas.width, canvas.height, avatarBounds);
      dim.setAttribute('d', outsideAvatar);
      aperture.setAttribute('d', outsideAvatar);
      dim.style.opacity = String(smooth(elapsed / Math.min(bodyMs, 150)) * .6);
      const session = sessionRef.current;
      layer.style.visibility = session ? 'visible' : 'hidden';
      if (!session) return false;
      const { motion, rect, texture, side } = session;
      const time = motion.morphStart * smooth(progress), loops = motion.contour(time);
      const path = motion.path(loops);
      body.setAttribute('d', path);
      body.style.opacity = elapsed > 0 ? '1' : '0';
      tail.setAttribute('d', motion.path(speechCloudTail(loops, avatarBounds,
        clamp((elapsed - delayMs) / tailMs), bend, side)));
      // Text is warped throughout motion; live text appears only at the endpoint.
      const settled = progress >= 1;
      content.style.opacity = settled ? '1' : '0';
      content.style.pointerEvents = settled && active ? 'auto' : 'none';
      content.setAttribute('aria-hidden', settled && active ? 'false' : 'true');
      canvas.style.opacity = settled || !texture ? '0' : String(smooth(progress / .25));
      if (!settled && context && texture && typeof Path2D !== 'undefined') {
        // Keep the real avatar visible even while the source shell crosses it.
        // Canvas owns this clipping too, avoiding SVG/Canvas compositing on iOS.
        context.resetTransform();
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.save();
        context.clip(new Path2D(outsideAvatar), 'evenodd');
        paintLiquidMesh(context, texture, loops, smooth((progress - .75) / .25), rect,
          0, 1 - smooth((progress - .8) / .2), false, new Path2D(path));
        context.restore();
      }
      return true;
    };
    const finishClose = () => {
      elapsedRef.current = 0;
      pulseStartRef.current = null;
      sessionRef.current = null;
      animatedAvatar.style.transform = '';
      setPresented(false);
    };
    const tick = (now: number) => {
      if (disposed) return;
      const delta = Math.max(0, now - lastTime);
      lastTime = now;
      elapsedRef.current = reduced ? (active ? total : 0) : clamp(elapsedRef.current + (active ? delta : -delta), 0, total);
      if (!draw(now)) {
        finishClose();
        return;
      }
      const pulseRunning = !reduced && (active
        ? pulseStartRef.current !== null && now - pulseStartRef.current < 400
        : now - closeStarted < 100);
      if (!active && elapsedRef.current === 0 && !pulseRunning) { finishClose(); return; }
      if ((active ? elapsedRef.current < total : elapsedRef.current > 0) || pulseRunning)
        frame = requestAnimationFrame(tick);
    };
    const invalidate = (event?: Event) => {
      if (event?.type === 'scroll' && event.target instanceof Node && content.contains(event.target)) return;
      dirty = true;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(tick);
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => invalidate());
    observer?.observe(anchor);
    observer?.observe(layer);
    observer?.observe(measure);
    // Scroll events do not bubble, so capture ancestor scrolls while presented.
    window.addEventListener('scroll', invalidate, true);
    window.addEventListener('resize', invalidate);
    window.visualViewport?.addEventListener('resize', invalidate);
    window.visualViewport?.addEventListener('scroll', invalidate);
    layer.ownerDocument.fonts?.addEventListener('loadingdone', invalidate);
    frame = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('scroll', invalidate, true);
      window.removeEventListener('resize', invalidate);
      window.visualViewport?.removeEventListener('resize', invalidate);
      window.visualViewport?.removeEventListener('scroll', invalidate);
      layer.ownerDocument.fonts?.removeEventListener('loadingdone', invalidate);
    };
  }, [active, visible, text, widthLimit, bodyMs, tailMs, delayMs, bend,
    availableArea?.left, availableArea?.top, availableArea?.width, availableArea?.height]);

  useLayoutEffect(() => {
    const element = avatarRef.current;
    return () => { if (element) element.style.transform = ''; };
  }, []);

  return <>
    <span ref={anchorRef} className="ui-speech-cloud__anchor" aria-describedby={visible ? contentId : undefined}>
      <span ref={avatarRef} className="ui-speech-cloud__avatar">{avatar}</span>
    </span>
    {visible && typeof document !== 'undefined' && createPortal(
      <div ref={layerRef} className="ui-speech-cloud">
        <Text variant="body" className="ui-speech-cloud__measure" aria-hidden="true">
          <span ref={measureRef} className="ui-speech-cloud__measure-text">{displayedText.current}</span>
        </Text>
        <svg className="ui-speech-cloud__scene" aria-hidden="true" onClick={() => onOpenChange(false)}>
          <defs>
            <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">
              <path ref={apertureRef} fill="white" fillRule="evenodd" />
            </mask>
          </defs>
          <path ref={dimRef} fill="black" fillRule="evenodd" opacity="0" />
          <g mask={`url(#${maskId})`}>
            <path ref={tailRef} fill="white" />
            <path ref={bodyRef} fill="white" />
          </g>
        </svg>
        <canvas ref={canvasRef} className="ui-speech-cloud__canvas" aria-hidden="true" />
        <div ref={contentRef} id={contentId} className="ui-speech-cloud__content" role="dialog" aria-label={label} aria-modal="true" aria-hidden="true">
          <Text variant="body" className="ui-speech-cloud__text">{displayedText.current}</Text>
        </div>
      </div>, document.body)}
  </>;
}
