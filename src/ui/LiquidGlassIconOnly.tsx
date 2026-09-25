import { useLayoutEffect, useReducer, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { mountPrototype, type PrototypeController } from './liquid-glass-icon-only/prototypeRuntime';
import prototypeCss from './liquid-glass-icon-only/prototype.css?inline';

export type LiquidGlassIconOnlyTab = {
  value: string;
  label: string;
  icon: { outline: ReactElement; filled: ReactElement };
};
export type LiquidGlassIconOnlyProps = {
  tabs: readonly LiquidGlassIconOnlyTab[];
  value: string;
  onValueChange: (value: string) => void;
  hidden: boolean;
};

const PROTOTYPE_LENS_STYLE = {
  '--sl-glass-tint': '.17',
  '--sl-backdrop-blur': '0px',
  '--sl-glass-brightness': '1.02',
  '--sl-bezel-opacity': '.86',
} as CSSProperties;

function Scene({ tabs, value, onValueChange, entrance }: Omit<LiquidGlassIconOnlyProps, 'hidden'> & { entrance: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<PrototypeController | null>(null);
  const latest = useRef({ tabs, value, onValueChange });
  const [selectionRequest, reconcileSelection] = useReducer((revision: number) => revision + 1, 0);
  const initialEntrance = useRef(entrance);
  const [shadow, setShadow] = useState<ShadowRoot | null>(null);
  // Recreate the private scene on changes of order; ordinary label/icon updates use React.
  const order = JSON.stringify(tabs.map(tab => tab.value));
  useLayoutEffect(() => {
    const element = host.current;
    if (element) setShadow(element.shadowRoot ?? element.attachShadow({ mode: 'open' }));
  }, []);
  useLayoutEffect(() => { latest.current = { tabs, value, onValueChange }; });
  useLayoutEffect(() => {
    if (!shadow || tabs.length === 0) return;
    const activeIndex = Math.max(0, latest.current.tabs.findIndex(tab => tab.value === latest.current.value));
    controller.current = mountPrototype(shadow, activeIndex, index => {
      const current = latest.current, tab = current.tabs[index];
      if (tab && tab.value !== current.value) current.onValueChange(tab.value);
      reconcileSelection();
    }, initialEntrance.current);
    return () => { controller.current?.dispose(); controller.current = null; };
    // The runtime captures only stable IDs/order. Props are read through latest.
  }, [shadow, order]);
  useLayoutEffect(() => {
    controller.current?.setValue(Math.max(0, tabs.findIndex(tab => tab.value === value)));
  }, [value, order, shadow, selectionRequest]);

  return <div ref={host} style={{ display: 'block', position: 'relative', width: '100%', height: 64, overflow: 'visible' }}>
    {shadow && createPortal(<>
      <style>{prototypeCss}</style>
      <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute', pointerEvents: 'none' }}>
        <filter id="icon-displacement-filter" colorInterpolationFilters="sRGB" x="-160%" y="-160%" width="420%" height="420%">
          <feImage id="zoom-vector-image" x="0" y="0" width="64" height="64" preserveAspectRatio="none" result="zoomMap" />
          <feDisplacementMap id="zoom-displacement" in="SourceGraphic" in2="zoomMap" scale="64" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="standalone-lens-filter" colorInterpolationFilters="sRGB" />
      </svg>
      <div className="motion" id="motion"><div className="scale" id="scale" />
        <div className="icon-mask" id="iconMask"><div id="iconLayer">
          <div className="donor-root dark">
            <div className="standalone-lens-playground optical-tabs-playground" data-tab-mode="icons">
              <div className="toolbar-pane optical-toolbar-pane" id="toolbar-pane">
                <div className="tab-strip" id="tab-strip" role="tablist" aria-label="Навигация">
                  {tabs.map((tab, index) => <button className={`tab-link${tab.value === value ? ' active' : ''}`} type="button" key={tab.value} data-index={index} role="tab" aria-label={tab.label} aria-selected={tab.value === value} title={tab.label}>
                    <span className="tab-content"><span className="tab-icon-wrap" aria-hidden="true">
                      <span className="tab-icon tab-icon-outline">{tab.icon.outline}</span>
                      <span className="tab-icon tab-icon-filled">{tab.icon.filled}</span>
                    </span><span className="tab-label">{tab.label}</span></span>
                  </button>)}
                  <span className="selector-track" id="selector-track" aria-hidden="true"><span className="selector" id="selector" /></span>
                </div>
              </div>
              <span className="selector-track extracted-lens-demo" id="lens-track" aria-hidden="true"><span className="lens optical-working-lens" id="lens" style={PROTOTYPE_LENS_STYLE} /></span>
            </div>
          </div>
        </div></div>
        <div className="shape" id="shape" />
      </div>
    </>, shadow)}
  </div>;
}

/** Owns the approved prototype; has no dependency on Tabs or Konsta private DOM. */
export function LiquidGlassIconOnly(props: LiquidGlassIconOnlyProps) {
  const previousHidden = useRef(props.hidden);
  const entrance = previousHidden.current && !props.hidden;
  useLayoutEffect(() => { previousHidden.current = props.hidden; }, [props.hidden]);
  const order = JSON.stringify(props.tabs.map(tab => tab.value));
  return <div hidden={props.hidden} aria-hidden={props.hidden || undefined} style={{ width: '100%', overflow: 'visible' }}>
    {!props.hidden && props.tabs.length > 0 && <Scene key={order} {...props} entrance={entrance} />}
  </div>;
}
