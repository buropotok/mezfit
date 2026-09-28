import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { resolveUiIconPair } from './Icon';
import type { UiIconSource } from './iconPair';
import { Tabs, TabsList, TabsTrigger } from './components';
import { mountPrototype, type PrototypeController } from './liquid-glass-tabs-no-fab/prototypeRuntime';
import prototypeCss from './liquid-glass-tabs-no-fab/prototype.css?inline';

export type LiquidGlassTabsNoFabTab = {
  value: string;
  label: string;
  icon: UiIconSource;
};

export type LiquidGlassTabsNoFabProps = {
  tabs: readonly LiquidGlassTabsNoFabTab[];
  value: string;
  onValueChange: (value: string) => void;
  hidden: boolean;
};

function Scene({ tabs, value, onValueChange, entrance }: Omit<LiquidGlassTabsNoFabProps, 'hidden'> & { entrance: boolean }) {
  const startupHost = useRef<HTMLDivElement>(null);
  const tabsHost = useRef<HTMLDivElement>(null);
  const controller = useRef<PrototypeController | null>(null);
  const [shadow, setShadow] = useState<ShadowRoot | null>(null);

  useLayoutEffect(() => {
    const element = startupHost.current;
    if (element) setShadow(element.shadowRoot ?? element.attachShadow({ mode: 'open' }));
  }, []);

  useLayoutEffect(() => {
    if (!shadow || !tabsHost.current) return;
    controller.current = mountPrototype(shadow, tabsHost.current, entrance);
    return () => {
      controller.current?.dispose();
      controller.current = null;
    };
  }, [shadow, entrance]);

  return (
    <div style={{ position: 'relative', width: '100%', height: 64, overflow: 'visible' }}>
      <div
        ref={tabsHost}
        data-liquid-glass-tabs-no-fab-real=""
        style={{
          position: 'absolute',
          left: '50%',
          top: 0,
          width: 'calc(100% / 1.1)',
          height: 64,
          transform: 'translateX(-50%)',
          zIndex: 2,
          opacity: entrance ? 0 : 1,
          pointerEvents: entrance ? 'none' : 'auto',
        }}
      >
        <Tabs theme="liquidGlass" mode="icon" value={value} onValueChange={onValueChange}>
          <TabsList aria-label="Навигация">
            {tabs.map(tab => (
              <TabsTrigger key={tab.value} value={tab.value} icon={tab.icon} aria-label={tab.label} title={tab.label}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div
        ref={startupHost}
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 3,
          overflow: 'visible',
          pointerEvents: 'none',
        }}
      >
        {shadow && createPortal(<>
          <style>{prototypeCss}</style>
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
                <feColorMatrix
                  type="matrix"
                  values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 1 0 0"
                />
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
                <image id="startup-mask-surface" x="0" y="0" preserveAspectRatio="none" filter="url(#startup-mask-from-blue)" />
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
                </foreignObject>
              </g>
            </g>

            <g mask="url(#startup-reveal-mask)" pointerEvents="none">
              <rect id="startup-material-surface" x="0" y="0" width="100%" height="100%" fill="rgb(185,208,239)" fillOpacity=".032" />
            </g>
            <image id="startup-bezel-surface" x="0" y="0" preserveAspectRatio="none" pointerEvents="none" />
          </svg>
        </>, shadow)}
      </div>
    </div>
  );
}

/**
 * Canonical liquidGlass icon tabs with the approved center-spread entrance.
 * The startup overlay is temporary; settled interaction is owned by the UI Kit Tabs primitive.
 */
export function LiquidGlassTabsNoFab(props: LiquidGlassTabsNoFabProps) {
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
      style={{ position: 'relative', width: '100%', height: 64, overflow: 'visible' }}
    >
      {!props.hidden && props.tabs.length > 0 && <Scene key={order} {...props} entrance={entrance} />}
    </div>
  );
}
