import { useLayoutEffect, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { mountPrototype, type PrototypeController } from './liquid-glass-text-only/prototypeRuntime';
import prototypeCss from './liquid-glass-text-only/prototype.css?inline';

export type LiquidGlassTextOnlyTab = {
  value: string;
  label: string;
};

export type LiquidGlassTextOnlyProps = {
  tabs: readonly LiquidGlassTextOnlyTab[];
  value: string;
  onValueChange: (value: string) => void;
  hidden: boolean;
};

function Scene({ tabs, value, onValueChange }: Omit<LiquidGlassTextOnlyProps, 'hidden'>) {
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<PrototypeController | null>(null);
  const latest = useRef({ tabs, value, onValueChange });
  const [selectionRequest, reconcileSelection] = useReducer((revision: number) => revision + 1, 0);
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
    if (!shadow || tabs.length === 0) return;
    const activeIndex = Math.max(0, latest.current.tabs.findIndex(tab => tab.value === latest.current.value));
    controller.current = mountPrototype(shadow, activeIndex, index => {
      const current = latest.current;
      const tab = current.tabs[index];
      if (tab && tab.value !== current.value) current.onValueChange(tab.value);
      reconcileSelection();
    });
    return () => {
      controller.current?.dispose();
      controller.current = null;
    };
  }, [shadow, order]);

  useLayoutEffect(() => {
    controller.current?.setValue(Math.max(0, tabs.findIndex(tab => tab.value === value)));
  }, [value, order, shadow, selectionRequest, tabs]);

  return (
    <div ref={host} style={{ display: 'block', position: 'relative', width: '100%', height: 44, overflow: 'visible' }}>
      {shadow && createPortal(<>
        <style>{prototypeCss}</style>
        <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute', pointerEvents: 'none' }}>
          <filter id="standalone-lens-filter" colorInterpolationFilters="sRGB" />
        </svg>
        <div className="text-only-stage">
          <div className="optical-tabs-playground" id="playground">
            <div className="toolbar-pane" id="toolbar-pane">
              <div className="selector-mask" id="selector-mask">
                <div className="tab-strip" id="tab-strip" role="tablist" aria-label="Навигация">
                  {tabs.map((tab, index) => (
                    <button
                      className={`tab-link${tab.value === value ? ' active' : ''}`}
                      type="button"
                      key={tab.value}
                      data-index={index}
                      role="tab"
                      aria-selected={tab.value === value}
                    >
                      <span className="tab-label">{tab.label}</span>
                    </button>
                  ))}
                  <span className="selector-track" id="selector-track" aria-hidden="true">
                    <span className="selector" id="selector" />
                  </span>
                </div>
              </div>
            </div>
            <div className="lens-viewport" id="lens-viewport" aria-hidden="true">
              <span className="lens-track" id="lens-track">
                <span className="lens" id="lens" />
              </span>
            </div>
          </div>
        </div>
      </>, shadow)}
    </div>
  );
}

/** Owns the approved variable-width Text Only liquid-glass prototype. */
export function LiquidGlassTextOnly(props: LiquidGlassTextOnlyProps) {
  const order = JSON.stringify(props.tabs.map(tab => tab.value));
  return (
    <div
      hidden={props.hidden}
      aria-hidden={props.hidden || undefined}
      style={{ position: 'relative', width: '100%', height: 44, overflow: 'visible' }}
    >
      {!props.hidden && props.tabs.length > 0 && <Scene key={order} {...props} />}
    </div>
  );
}
