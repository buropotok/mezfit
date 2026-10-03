import { useLayoutEffect, useReducer, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { resolveUiIconPair } from './Icon';
import type { UiIconSource } from './iconPair';
import { mountPrototype as mountNoFabPrototype, type PrototypeController } from './liquid-glass-tabs-no-fab/prototypeRuntime';
import noFabPrototypeCss from './liquid-glass-tabs-no-fab/prototype.css?inline';
import { settledFabSlot } from './liquid-glass-icon-only/fabGeometry';

export type LiquidGlassIconOnlyTab = {
  value: string;
  label: string;
  icon: UiIconSource;
};

export type LiquidGlassIconOnlyProps = {
  tabs: readonly LiquidGlassIconOnlyTab[];
  value: string | null;
  onValueChange: (value: string) => void;
  hidden: boolean;
  fab?: ReactNode;
};

const PROTOTYPE_LENS_STYLE = {
  '--sl-glass-tint': '.17',
  '--sl-backdrop-blur': '0px',
  '--sl-glass-brightness': '1.02',
  '--sl-bezel-opacity': '.86',
} as CSSProperties;

function StartupIcons({ tabs }: { tabs: readonly LiquidGlassIconOnlyTab[] }) {
  return (
    <div className="startup-icons-layer">
      <div className="startup-icons-strip">
        {tabs.map(tab => {
          const icon = resolveUiIconPair(tab.icon);
          return (
            <span
              className="startup-icon-slot"
              style={{ width: `${100 / tabs.length}%` }}
              key={`startup-${tab.value}`}
            >
              <span className="startup-icon" aria-hidden="true">{icon.outline}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function NoFabStartupScene({ tabs }: { tabs: readonly LiquidGlassIconOnlyTab[] }) {
  return (
    <svg id="startupScene" className="startup-scene" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <filter id="startup-refraction-icons" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feImage id="startup-vector" x="0" y="0" preserveAspectRatio="none" result="rawMap" />
          <feComponentTransfer in="rawMap" result="map">
            <feFuncR type="linear" slope="1" intercept="-0.00196078431372549" />
            <feFuncG type="linear" slope="1" intercept="-0.00196078431372549" />
          </feComponentTransfer>
          <feDisplacementMap in="SourceGraphic" in2="map" scale="64" xChannelSelector="R" yChannelSelector="G" result="displaced" />
          <feColorMatrix id="startup-lens-saturation" in="displaced" type="saturate" values="1.29" />
        </filter>
        <filter id="startup-mask-from-blue" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 1 0 0" />
        </filter>
        <mask
          id="startup-reveal-mask"
          maskUnits="userSpaceOnUse"
          maskContentUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="100%"
          height="100%"
          style={{ maskType: 'alpha' }}
        >
          <image
            id="startup-mask-surface"
            x="0"
            y="0"
            preserveAspectRatio="none"
            filter="url(#startup-mask-from-blue)"
          />
        </mask>
      </defs>
      <g mask="url(#startup-reveal-mask)" pointerEvents="none">
        <foreignObject x="0" y="0" width="100%" height="100%">
          <div id="startup-backdrop-layer" className="startup-backdrop-layer" />
        </foreignObject>
      </g>
      <g mask="url(#startup-reveal-mask)">
        <g filter="url(#startup-refraction-icons)">
          <foreignObject id="startup-icons-fo" x="0" y="0" width="0" height="64">
            <StartupIcons tabs={tabs} />
          </foreignObject>
        </g>
      </g>
      <g mask="url(#startup-reveal-mask)" pointerEvents="none">
        <rect
          id="startup-material-surface"
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgb(185,208,239)"
          fillOpacity=".032"
        />
      </g>
      <image id="startup-bezel-surface" x="0" y="0" preserveAspectRatio="none" pointerEvents="none" />
    </svg>
  );
}

function Scene({
  tabs,
  value,
  onValueChange,
  entrance,
}: Omit<LiquidGlassIconOnlyProps, 'hidden' | 'fab'> & { entrance: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<PrototypeController | null>(null);
  const latest = useRef({ tabs, value, onValueChange });
  const [selectionRequest, reconcileSelection] = useReducer((revision: number) => revision + 1, 0);
  const initialEntrance = useRef(entrance);
  const [shadow, setShadow] = useState<ShadowRoot | null>(null);
  const order = JSON.stringify(tabs.map(tab => tab.value));

  useLayoutEffect(() => {
    const element = host.current;
    if (element) setShadow(element.shadowRoot ?? element.attachShadow({ mode: 'open' }));
  }, []);

  useLayoutEffect(() => {
    latest.current = { tabs, value, onValueChange };
  });

  useLayoutEffect(() => {
    if (!shadow || tabs.length === 0) return undefined;

    const resolvedIndex = latest.current.tabs.findIndex(tab => tab.value === latest.current.value);
    const activeIndex = Math.max(0, resolvedIndex);
    const playEntrance = initialEntrance.current;
    initialEntrance.current = false;
    const onSelect = (index: number) => {
      const current = latest.current;
      const tab = current.tabs[index];
      if (tab && tab.value !== current.value) current.onValueChange(tab.value);
      reconcileSelection();
    };

    controller.current = mountNoFabPrototype(shadow, activeIndex, onSelect, playEntrance);

    return () => {
      controller.current?.dispose();
      controller.current = null;
    };
  }, [shadow, order]);

  useLayoutEffect(() => {
    const index = tabs.findIndex(tab => tab.value === value);
    if (index < 0) controller.current?.clearValue();
    else controller.current?.setValue(index);
  }, [value, order, shadow, selectionRequest]);

  return (
    <>
      <div ref={host} style={{ display: 'block', position: 'relative', width: '100%', height: 64, overflow: 'visible' }}>
        {shadow && createPortal(
          <>
            <style>{noFabPrototypeCss}</style>
            <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute', pointerEvents: 'none' }}>
              <filter id="standalone-lens-filter" colorInterpolationFilters="sRGB" />
            </svg>
            <div className="motion" id="motion">
              <div className="icon-mask" id="iconMask">
                <div id="iconLayer">
                  <div className="donor-root dark">
                    <div className="standalone-lens-playground optical-tabs-playground" data-tab-mode="icons">
                      <div className="toolbar-pane optical-toolbar-pane" id="toolbar-pane">
                        <div className="tab-strip" id="tab-strip" role="tablist" aria-label="Навигация">
                          {tabs.map((tab, index) => {
                            const icon = resolveUiIconPair(tab.icon);
                            return (
                              <button
                                className={`tab-link${tab.value === value ? ' active' : ''}`}
                                type="button"
                                key={tab.value}
                                data-index={index}
                                role="tab"
                                aria-label={tab.label}
                                aria-selected={tab.value === value}
                                title={tab.label}
                              >
                                <span className="tab-content">
                                  <span className="tab-icon-wrap" aria-hidden="true">
                                    <span className="tab-icon tab-icon-outline">{icon.outline}</span>
                                    <span className="tab-icon tab-icon-filled">{icon.filled}</span>
                                  </span>
                                  <span className="tab-label">{tab.label}</span>
                                </span>
                              </button>
                            );
                          })}
                          <span className="selector-track" id="selector-track" aria-hidden="true">
                            <span className="selector" id="selector" />
                          </span>
                        </div>
                      </div>
                      <span className="selector-track extracted-lens-demo" id="lens-track" aria-hidden="true">
                        <span className="lens optical-working-lens" id="lens" style={PROTOTYPE_LENS_STYLE} />
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <NoFabStartupScene tabs={tabs} />
          </>,
          shadow,
        )}
      </div>
    </>
  );
}

/** Positions the existing FAB independently of the tab animation lifecycle. */
function FabSlot({ children }: { children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = host.current;
    const container = element?.parentElement;
    if (!element || !container) return undefined;
    element.inert = false;
    const place = () => {
      const position = settledFabSlot(container.clientWidth);
      element.style.left = `${position.left}px`;
      element.style.top = `${position.top}px`;
    };
    place();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    observer?.observe(container);
    return () => observer?.disconnect();
  }, []);
  return (
    <div ref={host} data-liquid-glass-fab-slot="" style={{ position: 'absolute', width: 88, height: 88, zIndex: 4, opacity: 1, pointerEvents: 'auto' }}>
      {children}
    </div>
  );
}

/** Approved no-FAB tab runtime, with an independently rendered optional FAB. */
export function LiquidGlassIconOnly(props: LiquidGlassIconOnlyProps) {
  const previousHidden = useRef(props.hidden);
  const entrance = previousHidden.current && !props.hidden;

  useLayoutEffect(() => {
    previousHidden.current = props.hidden;
  }, [props.hidden]);

  const order = JSON.stringify(props.tabs.map(tab => tab.value));

  return (
    <div
      hidden={props.hidden}
      aria-hidden={props.hidden || undefined}
      style={{ position: 'relative', width: '100%', overflow: 'visible' }}
    >
      {!props.hidden && props.tabs.length > 0 && <Scene key={order} tabs={props.tabs} value={props.value} onValueChange={props.onValueChange} entrance={entrance} />}
      {!props.hidden && props.tabs.length > 0 && props.fab != null && <FabSlot>{props.fab}</FabSlot>}
    </div>
  );
}
