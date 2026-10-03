/** @vitest-environment jsdom */
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiquidGlassIconOnly, type LiquidGlassIconOnlyTab } from './LiquidGlassIconOnly';

const tabs:LiquidGlassIconOnlyTab[]=['Сегодня','Клиенты','Программы','Аналитика','Настройки'].map((label,i)=>({value:String(i),label,icon:{outline:<svg data-art={`${i}-outline`}/>,filled:<svg data-art={`${i}-filled`}/>}}));
const namedTabs:LiquidGlassIconOnlyTab[]=[
  {value:'today',label:'Сегодня',icon:'calendar-event'},
  {value:'clients',label:'Клиенты',icon:'users'},
  {value:'programs',label:'Программы',icon:'clipboard-list'},
  {value:'analytics',label:'Аналитика',icon:'chart-dots-2'},
  {value:'settings',label:'Настройки',icon:'settings'},
];
const changed=vi.fn();
function ui(hidden=false, value:string|null='0', list=tabs, withFab=false){return <LiquidGlassIconOnly hidden={hidden} tabs={list} value={value} onValueChange={changed} fab={withFab?<button data-test-fab type="button">＋</button>:undefined}/>}
function getScene(container:HTMLElement):ShadowRoot {
  const host=container.firstElementChild?.firstElementChild;
  if(!host?.shadowRoot)throw new Error('Visible scene must own a shadow root');
  return host.shadowRoot;
}
function button(root:ShadowRoot,index:number):HTMLButtonElement {
  const result=root.querySelectorAll('button')[index];if(!result)throw new Error('Missing tab');return result;
}
function element(root:ShadowRoot,id:string):HTMLElement {
  const result=root.getElementById(id);if(!(result instanceof HTMLElement))throw new Error('Missing '+id);return result;
}
const cancels:ReturnType<typeof vi.fn>[]=[];
const nativeQuerySelectorAll=Element.prototype.querySelectorAll;
beforeEach(()=>{
  vi.useFakeTimers();changed.mockClear();cancels.length=0;
  vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
  vi.stubGlobal('matchMedia',()=>({matches:false}));
  vi.stubGlobal('PointerEvent',class extends MouseEvent {pointerId:number;pointerType:string;constructor(type:string,init:PointerEventInit={}){super(type,init);this.pointerId=init.pointerId??1;this.pointerType=init.pointerType??'touch'}});
  vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockReturnValue(390);
  vi.spyOn(HTMLElement.prototype,'offsetWidth','get').mockImplementation(function(this:HTMLElement){return this.classList.contains('tab-link')?78:390});
  vi.spyOn(HTMLElement.prototype,'offsetLeft','get').mockImplementation(function(this:HTMLElement){
    if(!this.classList.contains('tab-link'))return 0;
    const siblings=this.parentElement?[...this.parentElement.children]:[];
    return siblings.indexOf(this)*78;
  });
  vi.spyOn(HTMLElement.prototype,'offsetHeight','get').mockReturnValue(64);
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){
    const width=this.classList.contains('tab-link')?78:390;
    const siblings=this.parentElement?[...this.parentElement.children]:[];
    const index=this.classList.contains('tab-link')?siblings.indexOf(this):0;
    const left=index*78;
    return {x:left,y:0,left,top:0,right:left+width,bottom:64,width,height:64,toJSON:()=>({})};
  });
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
  Object.defineProperty(Element.prototype,'animate',{configurable:true,value:vi.fn(()=>{const cancel=vi.fn();cancels.push(cancel);return {cancel,addEventListener:vi.fn(),removeEventListener:vi.fn()}})});
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals()});

describe('direct prototype adapter',()=>{
  it('renders no scene, lenses, icons or timers while hidden',()=>{
    const view=render(ui(true));expect(view.container.firstElementChild?.hasAttribute('hidden')).toBe(true);
    expect(view.container.firstElementChild?.childElementCount).toBe(0);expect(vi.getTimerCount()).toBe(0);
  });
  it('shows the settled original structure on initial false with supplied artwork',()=>{
    const view=render(ui());const root=getScene(view.container);
    expect(root.querySelector('.ui-tabs')).toBeNull();expect(root.querySelectorAll('.tab-link')).toHaveLength(5);
    expect(element(root,'iconMask').classList.contains('tabs-interactive')).toBe(true);
    expect(button(root,2).getAttribute('aria-label')).toBe('Программы');expect(root.querySelector('[data-art="2-filled"]')).not.toBeNull();
    expect(button(root,0).style.width).toBe('20%');
  });
  it('supports an explicitly inactive selection and restores it when a primary value returns',()=>{
    const view=render(ui(false,null));const root=getScene(view.container);
    expect([...root.querySelectorAll('[role="tab"]')].some(tab=>tab.getAttribute('aria-selected')==='true')).toBe(false);
    expect(element(root,'selector-track').style.visibility).toBe('hidden');
    expect(element(root,'lens-track').style.visibility).toBe('hidden');
    view.rerender(ui(false,'2'));
    expect(button(root,2).getAttribute('aria-selected')).toBe('true');
    expect(element(root,'selector-track').style.visibility).toBe('');
    expect(element(root,'lens-track').style.visibility).toBe('');
  });
  it('resolves registered icon names inside the prototype scene',()=>{
    const view=render(ui(false,'today',namedTabs));const root=getScene(view.container);
    const outline=root.querySelector<HTMLElement>('.tab-link .tab-icon-outline .ui-icon');
    const filled=root.querySelector<HTMLElement>('.tab-link .tab-icon-filled .ui-icon');
    expect(outline).not.toBeNull();expect(filled).not.toBeNull();
    const outlineMask=outline?.style.getPropertyValue('mask-image')??'';
    const filledMask=filled?.style.getPropertyValue('mask-image')??'';
    expect(outlineMask).toContain('data:image/svg+xml');
    expect(filledMask).toContain('data:image/svg+xml');
    expect(filledMask).not.toBe(outlineMask);
  });
  it('restores the approved prototype optical lens variables',()=>{
    const view=render(ui());const lens=element(getScene(view.container),'lens');
    expect(lens.style.getPropertyValue('--sl-glass-tint')).toBe('.17');
    expect(lens.style.getPropertyValue('--sl-backdrop-blur')).toBe('0px');
    expect(lens.style.getPropertyValue('--sl-glass-brightness')).toBe('1.02');
    expect(lens.style.getPropertyValue('--sl-bezel-opacity')).toBe('.86');
  });
  it('uses the tuned startup material and hands off to the FAB with the tabs',()=>{
    const view=render(ui(true,'0',tabs,true));view.rerender(ui(false,'0',tabs,true));const root=getScene(view.container);
    const blur=root.getElementById('startup-lens-blur'),saturation=root.getElementById('startup-lens-saturation');
    const material=root.getElementById('startup-material-surface');
    const fabSlot=view.container.querySelector<HTMLElement>('[data-liquid-glass-fab-slot]');
    expect(blur?.getAttribute('stdDeviation')).toBe('0.50');
    expect(saturation?.getAttribute('values')).toBe('1.24');
    expect(Number(material?.getAttribute('fill-opacity'))).toBeCloseTo(.03,2);
    expect(fabSlot).not.toBeNull();expect(fabSlot?.style.opacity).toBe('0');expect(fabSlot?.style.pointerEvents).toBe('none');
    expect(fabSlot?.inert).toBe(true);expect(fabSlot?.getAttribute('aria-hidden')).toBe('true');
    expect(Number.parseFloat(fabSlot?.style.top??'0')).toBeLessThan(0);
    act(()=>vi.advanceTimersByTime(880));
    expect(element(root,'iconMask').classList.contains('tabs-interactive')).toBe(true);
    expect(fabSlot?.style.opacity).toBe('1');expect(fabSlot?.style.pointerEvents).toBe('auto');
    expect(fabSlot?.inert).toBe(false);expect(fabSlot?.hasAttribute('aria-hidden')).toBe(false);
  });
  it('plays the no-FAB reveal once for true -> false, settles, and does not replay on selection/parent renders',()=>{
    const view=render(ui(true));view.rerender(ui(false));const root=getScene(view.container);
    expect(element(root,'iconLayer').hasAttribute('startup')).toBe(true);
    act(()=>vi.advanceTimersByTime(940));expect(element(root,'iconMask').classList.contains('tabs-interactive')).toBe(true);
    const count=cancels.length;view.rerender(ui(false,'2'));expect(cancels).toHaveLength(count);
    expect(button(root,2).getAttribute('aria-selected')).toBe('true');
  });
  it('does not replay the entrance when FAB availability changes after settling',()=>{
    const view=render(ui(true));view.rerender(ui(false));const root=getScene(view.container);
    act(()=>vi.advanceTimersByTime(940));expect(element(root,'iconMask').classList.contains('tabs-interactive')).toBe(true);
    view.rerender(ui(false,'0',tabs,true));
    const reboundRoot=getScene(view.container),fabSlot=view.container.querySelector<HTMLElement>('[data-liquid-glass-fab-slot]');
    expect(element(reboundRoot,'iconLayer').hasAttribute('startup')).toBe(false);
    expect(element(reboundRoot,'iconMask').classList.contains('tabs-interactive')).toBe(true);
    expect(fabSlot?.style.opacity).toBe('1');expect(fabSlot?.inert).toBe(false);
  });
  it('still plays the required no-FAB true -> false reveal when reduced motion is preferred',()=>{
    vi.stubGlobal('matchMedia',()=>({matches:true}));
    const view=render(ui(true));view.rerender(ui(false));const root=getScene(view.container);
    expect(element(root,'iconLayer').hasAttribute('startup')).toBe(true);
    act(()=>vi.advanceTimersByTime(940));expect(element(root,'iconMask').classList.contains('tabs-interactive')).toBe(true);
  });
  it('cancels all animation work on hide and can show again',()=>{
    const view=render(ui(true));view.rerender(ui(false));act(()=>vi.advanceTimersByTime(100));
    view.rerender(ui(true));expect(vi.getTimerCount()).toBe(0);expect(cancels.every(cancel=>cancel.mock.calls.length>0)).toBe(true);
    view.rerender(ui(false));expect(element(getScene(view.container),'iconLayer').hasAttribute('startup')).toBe(true);
    view.unmount();expect(vi.getTimerCount()).toBe(0);
  });
  it('requests the supplied value, and follows external value changes',()=>{
    const view=render(ui());const root=getScene(view.container);fireEvent.click(button(root,2));expect(changed).toHaveBeenCalledExactlyOnceWith('2');
    expect(button(root,0).getAttribute('aria-selected')).toBe('true');
    view.rerender(ui(false,'4'));expect(button(root,4).getAttribute('aria-selected')).toBe('true');
    expect(element(root,'selector-track').style.transform).toBe('translateX(312px)');
  });
  it('rebuilds geometry for reordered identities without replaying startup',()=>{
    const view=render(ui(false,'2'));view.rerender(ui(false,'2',[tabs[2],tabs[0],tabs[1],tabs[3],tabs[4]]));
    const root=getScene(view.container);expect(button(root,0).getAttribute('aria-selected')).toBe('true');
    expect(element(root,'selector-track').style.transform).toBe('translateX(0px)');expect(element(root,'iconMask').classList.contains('tabs-interactive')).toBe(true);
    view.rerender(ui(false,'2',tabs.slice(0,4)));expect(button(getScene(view.container),0).style.width).toBe('25%');
  });
  it('releases the tap spring in both FAB modes even when Web Animations never reports finish',()=>{
    Object.defineProperty(Element.prototype,'querySelectorAll',{configurable:true,value:function(this:Element,selector:string){
      if(selector===':scope > .tab-link')return [...this.children].filter(child=>child instanceof HTMLElement&&child.classList.contains('tab-link'));
      return nativeQuerySelectorAll.call(this,selector);
    }});
    try{
      for(const withFab of [false,true]){
        const view=render(ui(false,'0',tabs,withFab));const root=getScene(view.container);const pane=element(root,'toolbar-pane');
        fireEvent.pointerDown(button(root,3),{composed:true,pointerId:1,clientX:273,clientY:32,pointerType:'touch'});
        fireEvent(pane.ownerDocument,new PointerEvent('pointerup',{bubbles:true,composed:true,pointerId:1,clientX:273,clientY:32,pointerType:'touch'}));
        act(()=>vi.advanceTimersByTime(260));
        expect(element(root,'lens').classList.contains('tap-spring-active')).toBe(true);
        act(()=>vi.advanceTimersByTime(800));
        expect(element(root,'lens').classList.contains('tap-spring-active')).toBe(false);
        expect(element(root,'selector').classList.contains('tap-spring-hidden')).toBe(false);
        view.unmount();
      }
    }finally{
      Object.defineProperty(Element.prototype,'querySelectorAll',{configurable:true,value:nativeQuerySelectorAll});
    }
  });
  it('finishes touch interaction when captured pointerup is delivered only to the pane',()=>{
    for(const withFab of [false,true]){
      const view=render(ui(false,'0',tabs,withFab));const root=getScene(view.container);const pane=element(root,'toolbar-pane');
      fireEvent.pointerDown(button(root,3),{composed:true,pointerId:1,clientX:273,clientY:32,pointerType:'touch'});
      act(()=>vi.advanceTimersByTime(160));
      expect(element(root,'lens').classList.contains('pressed')).toBe(true);

      fireEvent(pane,new PointerEvent('pointerup',{bubbles:false,composed:true,pointerId:1,clientX:273,clientY:32,pointerType:'touch'}));

      expect(changed).toHaveBeenLastCalledWith('3');
      act(()=>vi.advanceTimersByTime(320));
      expect(element(root,'lens').classList.contains('pressed')).toBe(false);
      expect(element(root,'selector').classList.contains('pressed')).toBe(false);
      view.unmount();
      changed.mockClear();
    }
  });

  it('keeps the captured pointer active when a second touch ends first',()=>{
    for(const withFab of [false,true]){
      const view=render(ui(false,'0',tabs,withFab));const root=getScene(view.container);const pane=element(root,'toolbar-pane');
      fireEvent.pointerDown(button(root,3),{composed:true,pointerId:1,clientX:273,clientY:32,pointerType:'touch'});
      act(()=>vi.advanceTimersByTime(160));
      expect(element(root,'lens').classList.contains('pressed')).toBe(true);

      fireEvent(pane,new PointerEvent('pointerup',{bubbles:false,composed:true,pointerId:2,clientX:120,clientY:32,pointerType:'touch'}));

      expect(changed).not.toHaveBeenCalled();
      expect(element(root,'lens').classList.contains('pressed')).toBe(true);

      fireEvent(pane,new PointerEvent('pointerup',{bubbles:false,composed:true,pointerId:1,clientX:273,clientY:32,pointerType:'touch'}));

      expect(changed).toHaveBeenLastCalledWith('3');
      act(()=>vi.advanceTimersByTime(320));
      expect(element(root,'lens').classList.contains('pressed')).toBe(false);
      expect(element(root,'selector').classList.contains('pressed')).toBe(false);
      view.unmount();
      changed.mockClear();
    }
  });

  it('keeps touch selection and spring cleanup working across FAB mode changes during release',()=>{
    Object.defineProperty(Element.prototype,'querySelectorAll',{configurable:true,value:function(this:Element,selector:string){
      if(selector===':scope > .tab-link')return [...this.children].filter(child=>child instanceof HTMLElement&&child.classList.contains('tab-link'));
      return nativeQuerySelectorAll.call(this,selector);
    }});
    try{
      for(const initiallyWithFab of [false,true]){
        for(const hold of [false,true]){
          const view=render(ui(false,'0',tabs,initiallyWithFab));
          let withFab=initiallyWithFab;
          for(let transition=0;transition<3;transition++){
            const root=getScene(view.container),pane=element(root,'toolbar-pane');
            fireEvent.pointerDown(button(root,3),{composed:true,pointerId:1,clientX:273,clientY:32,pointerType:'touch'});
            if(hold)act(()=>vi.advanceTimersByTime(160));
            fireEvent(pane.ownerDocument,new PointerEvent('pointerup',{bubbles:true,composed:true,pointerId:1,clientX:273,clientY:32,pointerType:'touch'}));
            expect(changed).toHaveBeenLastCalledWith('3');
            expect(element(root,'lens').classList.contains(hold?'pressed':'tap-spring-active')).toBe(true);

            withFab=!withFab;
            view.rerender(ui(false,'3',tabs,withFab));
            const next=getScene(view.container),lens=element(next,'lens'),selector=element(next,'selector');
            expect(button(next,3).getAttribute('aria-selected')).toBe('true');
            expect(element(next,'iconLayer').hasAttribute('startup')).toBe(false);
            expect(element(next,'iconMask').classList.contains('tabs-interactive')).toBe(true);
            expect(lens.classList.contains('pressed')).toBe(false);
            expect(lens.classList.contains('tap-spring-active')).toBe(false);
            expect(selector.classList.contains('pressed')).toBe(false);
            expect(selector.classList.contains('tap-spring-hidden')).toBe(false);
            expect(Boolean(view.container.querySelector('[data-liquid-glass-fab-slot]'))).toBe(withFab);

            // A new tap in the destination mode must still animate and finish.
            fireEvent.pointerDown(button(next,0),{composed:true,pointerId:2,clientX:39,clientY:32,pointerType:'touch'});
            fireEvent(element(next,'toolbar-pane').ownerDocument,new PointerEvent('pointerup',{bubbles:true,composed:true,pointerId:2,clientX:39,clientY:32,pointerType:'touch'}));
            expect(changed).toHaveBeenLastCalledWith('0');
            view.rerender(ui(false,'0',tabs,withFab));
            act(()=>vi.advanceTimersByTime(260));
            expect(lens.classList.contains('tap-spring-active')).toBe(true);
            act(()=>vi.advanceTimersByTime(1100));
            expect(lens.classList.contains('pressed')).toBe(false);
            expect(lens.classList.contains('tap-spring-active')).toBe(false);
            expect(selector.classList.contains('tap-spring-hidden')).toBe(false);
            changed.mockClear();
          }
          view.unmount();expect(vi.getTimerCount()).toBe(0);
        }
      }
    }finally{
      Object.defineProperty(Element.prototype,'querySelectorAll',{configurable:true,value:nativeQuerySelectorAll});
    }
  });

  it('clears a pressed lens when pointer capture is lost',()=>{
    const view=render(ui());const root=getScene(view.container);const pane=element(root,'toolbar-pane');
    fireEvent.pointerDown(button(root,0),{composed:true,pointerId:1,clientX:39,clientY:32,pointerType:'touch'});
    act(()=>vi.advanceTimersByTime(160));
    expect(element(root,'lens').classList.contains('pressed')).toBe(true);
    fireEvent(pane,new PointerEvent('lostpointercapture',{bubbles:true,pointerId:1,pointerType:'touch'}));
    expect(element(root,'lens').classList.contains('pressed')).toBe(false);
    expect(element(root,'selector').classList.contains('pressed')).toBe(false);
    view.unmount();
  });
  it('retains hold/drag optics and cancels without changing selection',()=>{
    const view=render(ui());const root=getScene(view.container);const pane=element(root,'toolbar-pane');
    fireEvent.pointerDown(button(root,0),{composed:true,pointerId:1,clientX:39,clientY:32,pointerType:'touch'});
    act(()=>vi.advanceTimersByTime(160));expect(element(root,'lens').classList.contains('pressed')).toBe(true);
    fireEvent.pointerMove(pane,{composed:true,pointerId:1,clientX:300,clientY:32,pointerType:'touch'});
    fireEvent.pointerCancel(pane,{composed:true,pointerId:1,clientX:300,clientY:32,pointerType:'touch'});
    expect(changed).not.toHaveBeenCalled();
    view.unmount();expect(vi.getTimerCount()).toBe(0);
  });
  it('isolates two instances and cleans up under StrictMode',()=>{
    const view=render(<StrictMode>{ui()}{ui()}</StrictMode>);
    const first=view.container.children[0].firstElementChild?.shadowRoot,second=view.container.children[1].firstElementChild?.shadowRoot;
    expect(first).toBeTruthy();expect(second).toBeTruthy();expect(first).not.toBe(second);
    if(!first||!second)throw new Error('Missing scenes');
    fireEvent.click(button(first,1));expect(button(second,0).getAttribute('aria-selected')).toBe('true');
    view.unmount();expect(vi.getTimerCount()).toBe(0);
  });
});
