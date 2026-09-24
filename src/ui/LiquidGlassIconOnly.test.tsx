/** @vitest-environment jsdom */
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiquidGlassIconOnly, type LiquidGlassIconOnlyTab } from './LiquidGlassIconOnly';

const tabs:LiquidGlassIconOnlyTab[]=['Сегодня','Клиенты','Программы','Аналитика','Настройки'].map((label,i)=>({value:String(i),label,icon:{outline:<svg data-art={`${i}-outline`}/>,filled:<svg data-art={`${i}-filled`}/>}}));
const changed=vi.fn();
function ui(hidden=false, value='0', list=tabs){return <LiquidGlassIconOnly hidden={hidden} tabs={list} value={value} onValueChange={changed}/>}
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
beforeEach(()=>{
  vi.useFakeTimers();changed.mockClear();cancels.length=0;
  vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
  vi.stubGlobal('matchMedia',()=>({matches:false}));
  vi.stubGlobal('PointerEvent',class extends MouseEvent {pointerId:number;pointerType:string;constructor(type:string,init:PointerEventInit={}){super(type,init);this.pointerId=init.pointerId??1;this.pointerType=init.pointerType??'touch'}});
  vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockReturnValue(390);
  vi.spyOn(HTMLElement.prototype,'offsetWidth','get').mockImplementation(function(this:HTMLElement){return this.classList.contains('tab-link')?78:390});
  vi.spyOn(HTMLElement.prototype,'offsetHeight','get').mockReturnValue(64);
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){const width=this.classList.contains('tab-link')?78:390;const left=Number(this.dataset.index||0)*78;return {x:left,y:0,left,top:0,right:left+width,bottom:64,width,height:64,toJSON:()=>({})}});
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
  it('plays once for true -> false, settles, and does not replay on selection/parent renders',()=>{
    const view=render(ui(true));view.rerender(ui(false));const root=getScene(view.container);
    expect(element(root,'iconLayer').hasAttribute('startup')).toBe(true);
    act(()=>vi.advanceTimersByTime(900));expect(element(root,'iconMask').classList.contains('tabs-interactive')).toBe(true);
    const count=cancels.length;view.rerender(ui(false,'2'));expect(cancels).toHaveLength(count);
    expect(button(root,2).getAttribute('aria-selected')).toBe('true');
  });
  it('still plays the required true -> false reveal when reduced motion is preferred',()=>{
    vi.stubGlobal('matchMedia',()=>({matches:true}));
    const view=render(ui(true));view.rerender(ui(false));const root=getScene(view.container);
    expect(element(root,'iconLayer').hasAttribute('startup')).toBe(true);
    act(()=>vi.advanceTimersByTime(900));expect(element(root,'iconMask').classList.contains('tabs-interactive')).toBe(true);
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
