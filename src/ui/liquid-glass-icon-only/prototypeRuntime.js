// Direct extraction from the approved HTML, not a rewritten interaction model.
// See provenance.md for the extraction boundary and intentional lifecycle changes.
export function mountPrototype(root, initialIndex, onSelect, playEntrance) {
  const owner = root.ownerDocument;
  const host = root.getElementById('iconLayer');
  const events = new EventTarget();
  const timers = new Set(), frames = new Set(), observers = new Set(), animations = new Set(), disposers = [];
  let disposed = false, pointerId = null, selectIndex = () => {};
  const document = {
    getElementById: id => root.getElementById(id),
    createElement: tag => owner.createElement(tag),
    documentElement: root.host,
    addEventListener: owner.addEventListener.bind(owner),
    removeEventListener: owner.removeEventListener.bind(owner),
  };
  const window = {
    devicePixelRatio: owner.defaultView.devicePixelRatio,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  };
  function listen(target, type, callback, options) {
    const handler = (target === document && type.startsWith('pointer')) || (target === paneElement && type === 'pointerdown' && !options)
      ? event => { if (pointerId === event.pointerId) callback(event); }
      : callback;
    target.addEventListener(type, handler, options);
    disposers.push(() => target.removeEventListener(type, handler, options));
  }
  const paneElement = root.getElementById('toolbar-pane');
  listen(paneElement, 'pointerdown', event => {
    if (pointerId !== null && pointerId !== event.pointerId) return;
    pointerId = event.pointerId;
    if (event.pointerType === 'touch') paneElement.setPointerCapture?.(event.pointerId);
  }, true);
  function setTimeout(callback, delay) {
    const id = globalThis.setTimeout(() => { timers.delete(id); if (!disposed) callback(); }, delay);
    timers.add(id); return id;
  }
  function clearTimeout(id) { globalThis.clearTimeout(id); timers.delete(id); }
  function requestAnimationFrame(callback) {
    const id = globalThis.requestAnimationFrame(time => { frames.delete(id); if (!disposed) callback(time); });
    frames.add(id); return id;
  }
  function cancelAnimationFrame(id) { globalThis.cancelAnimationFrame(id); frames.delete(id); }
  class ResizeObserver extends globalThis.ResizeObserver {
    constructor(callback) { super(callback); observers.add(this); }
  }
  class MutationObserver extends globalThis.MutationObserver {
    constructor(callback) { super(callback); observers.add(this); }
  }
  function animate(element, keyframes, options) {
    if (!element.animate) return { cancel() {}, addEventListener() {}, removeEventListener() {} };
    const animation = element.animate(keyframes, options); animations.add(animation);
    animation.addEventListener('finish', () => animations.delete(animation), {once:true});
    return animation;
  }
    (() => {
      const holdDelayMs = 140;
      const pane = document.getElementById('toolbar-pane');
      const tabStrip = document.getElementById('tab-strip');
      const selectorTrack = document.getElementById('selector-track');
      const lensTrack = document.getElementById('lens-track');
      const selector = document.getElementById('selector');
      const lens = document.getElementById('lens');
      const links = [...tabStrip.querySelectorAll('.tab-link')];


      const data = {
        activeIndex: 0,
        newActiveIndex: 0,
        touched: false,
        moved: false,
        setTransform: null,
        raf: null,
        suppressNativeClick: false,
        lensPressedAt: 0,
        lensReleasePending: false,
        lensFullyExpanded: false,
        lensTimer: null,
        pressIntentTimer: null,
        gesture: 'idle',
        touchStartX: 0,
        touchStartY: 0,
        touchStartScrollLeft: 0,
        lastPointerX: 0,
        holdActivated: false,
        glass: {}
      };

      function isTextMode() {
        return pane.closest('.optical-tabs-playground')?.dataset.tabMode === 'text';
      }

      const TEXT_SELECTOR_EDGE = 4;       // L
      const TEXT_SELECTOR_TEXT_PAD = 8;   // padding inside visible selector

      const ICON_CONTENT_MIN = 28;
      const ICON_SELECTOR_TEXT_PAD = 8; // small reserve around widest content
      const ICON_SELECTOR_EDGE = 4;     // L: fixed Konsta inner frame

      // Vertical reserve around the ACTUAL icon+label stack.
      // The label sits visually lower, so bottom reserve is slightly larger.
      const ICON_SURFACE_PAD_TOP = 6;
      const ICON_SURFACE_PAD_BOTTOM = 8;
      const ICON_SURFACE_EDGE_MIN = 2;

      function syncIconSurfaceVerticalGeometry() {
        // Same base surface for the selector and refracting lens.
        selector.style.top = lens.style.top = '4px';
        selector.style.bottom = lens.style.bottom = '4px';
      }

      function syncSlotWidths() {
        const share = `${100 / links.length}%`;
        links.forEach(link => {
          link.style.width = share;
          link.style.flexBasis = share;
        });
        syncIconSurfaceVerticalGeometry();
      }

      function visualTrackGeometry(link) {
        if (!link) return {left:0, width:0};
        const width = tabStrip.clientWidth / links.length;
        return {left:links.indexOf(link) * width, width};
      }

      function positionSelector(index, animate = true) {
        const link = links[index];
        if (!link) return;

        const geometry = visualTrackGeometry(link);
        selectorTrack.style.transitionDuration = animate ? '300ms' : '0ms';
        selectorTrack.style.width = `${geometry.width}px`;
        selectorTrack.style.transform = `translateX(${geometry.left}px)`;
      }

      function positionLensTrack(index, animate = true) {
        const link = links[index];
        if (!link) return;

        const geometry = visualTrackGeometry(link);
        lensTrack.style.transitionDuration = animate ? '300ms' : '0ms';
        lensTrack.style.width = `${geometry.width}px`;
        const visualLeft = geometry.left - tabStrip.scrollLeft;
        lensTrack.style.transform = `translateX(${visualLeft}px)`;
      }

      function revealTab(index) {
        const link = links[index];
        if (!link) return;

        const left = link.offsetLeft;
        const right = left + link.offsetWidth;
        const visibleLeft = tabStrip.scrollLeft;
        const visibleRight = visibleLeft + tabStrip.clientWidth;

        if (left < visibleLeft || right > visibleRight) {
          const target = left - (tabStrip.clientWidth - link.offsetWidth) / 2;
          tabStrip.scrollTo({
            left: Math.max(0, target),
            behavior: 'smooth'
          });
        }
      }

      function updateActive(index, notify = true) {
        if (!links[index]) return;
        const previousIndex = data.activeIndex;
        data.activeIndex = index;
        data.newActiveIndex = index;


        links.forEach((link, i) => {
          const active = i === index;
          link.classList.toggle('active', active);
          link.setAttribute('aria-selected', active ? 'true' : 'false');
        });

        if (previousIndex !== index) {
          window.dispatchEvent(
            new CustomEvent('mezfit-tab-active-change', {
              detail: { index, previousIndex }
            })
          );
        }

        positionSelector(index);
        positionLensTrack(index);
        revealTab(index);
        requestAnimationFrame(syncIconSurfaceVerticalGeometry);
        if (notify) onSelect(index);


      }



      let stripScrollStart = 0;
      let stripDidScroll = false;

      listen(tabStrip, 'pointerdown', () => {
        stripScrollStart = tabStrip.scrollLeft;
        stripDidScroll = false;
      });

      listen(tabStrip, 'scroll', () => {
        if (Math.abs(tabStrip.scrollLeft - stripScrollStart) > 4) {
          stripDidScroll = true;
        }

        // Selector is a child of tabStrip and therefore moves with the same
        // scroll layer. No JS synchronization is needed here.
        //
        // Lens is outside the scroller; keep its resting position aligned only
        // while it is not actively controlled by a press gesture.
        if (data.gesture !== 'press') {
          positionLensTrack(data.activeIndex, false);
        }
      }, { passive: true });

      links.forEach((link, index) => {
        listen(link, 'click', (event) => {
          if (stripDidScroll) {
            event.preventDefault();
            stripDidScroll = false;
            return;
          }
          updateActive(index);
        });
      });

      // Konsta useIosTabbarHighlight — translated directly to standalone JS.
      function startAnimation() {
        data.raf = requestAnimationFrame(() => {
          if (!data.setTransform) return;
          lensTrack.style.transform = data.setTransform;
          lensTrack.style.transitionTimingFunction = 'ease-out';
          data.setTransform = null;
        });
      }

      function stopAnimation() {
        cancelAnimationFrame(data.raf);
      }

      const LENS_EXPAND_MS = 300;

      function beginLensExpansion() {
        clearTimeout(data.lensTimer);

        data.lensPressedAt = performance.now();
        data.lensReleasePending = false;
        data.lensFullyExpanded = false;

        selector.classList.add('pressed');
        lens.classList.add('pressed');

        data.lensTimer = setTimeout(() => {
          data.lensFullyExpanded = true;

          // If the finger was already released, the lens is allowed to
          // shrink only now, after reaching its full 1.4 scale.
          if (data.lensReleasePending) {
            endLensExpansion();
          }
        }, LENS_EXPAND_MS);
      }

      function requestLensRelease() {
        if (data.lensFullyExpanded) {
          endLensExpansion();
          return;
        }

        // Keep the pressed/full-growth target in place. The timer completes
        // the growth first, then starts the shrink.
        data.lensReleasePending = true;
      }

      function endLensExpansion() {
        clearTimeout(data.lensTimer);
        data.lensTimer = null;
        data.lensReleasePending = false;
        data.lensFullyExpanded = false;

        selector.classList.remove('pressed');
        lens.classList.remove('pressed');
      }

      function cancelLensForScroll() {
        clearTimeout(data.lensTimer);
        data.lensTimer = null;
        data.lensReleasePending = false;
        data.lensFullyExpanded = false;

        selector.classList.remove('pressed');
        lens.classList.remove('pressed');
      }

      function setHighlightOnTouch(
        e,
        { startLens = true, holdStart = false } = {}
      ) {
        const rect = tabStrip.getBoundingClientRect();
        const contentX = e.clientX - rect.left + tabStrip.scrollLeft;

        const centers = links.map((link) => link.offsetLeft + link.offsetWidth / 2);
        const closestCenter = centers.reduce((prev, curr) =>
          Math.abs(curr - contentX) < Math.abs(prev - contentX) ? curr : prev
        , centers[0]);

        data.newActiveIndex = centers.indexOf(closestCenter);
        const targetLink = links[data.newActiveIndex];
        const targetGeometry = visualTrackGeometry(targetLink);
        const minLeft = 0;
        const maxLeft = tabStrip.scrollWidth - targetGeometry.width;
        const rawLeft = contentX - targetGeometry.width / 2;
        const translateX = Math.max(minLeft, Math.min(rawLeft, maxLeft));
        const visualTranslateX = translateX - tabStrip.scrollLeft;

        // Width now animates together with X when Text labels have different
        // lengths. Icons mode still resolves to the fixed 92px slot.
        lensTrack.style.width = `${targetGeometry.width}px`;

        if (holdStart) {
          // Long press only:
          // snap to the nearest TAB CENTER, while using that label's width.
          const snappedContentX = targetGeometry.left;
          const snappedVisualX = snappedContentX - tabStrip.scrollLeft;

          lensTrack.style.transitionDuration = '0ms';
          lensTrack.style.transitionTimingFunction = '';
          lensTrack.style.transform = `translateX(${snappedVisualX}px)`;

          // Hidden selector follows the exact same content-sized geometry.
          selectorTrack.style.transitionDuration = '0ms';
          selectorTrack.style.transitionTimingFunction = '';
          selectorTrack.style.width = `${targetGeometry.width}px`;
          selectorTrack.style.transform = `translateX(${snappedContentX}px)`;

          // Make sure snapped geometry is committed before scale/opacity starts.
          void lensTrack.offsetWidth;

          if (startLens && !lens.classList.contains('pressed')) {
            beginLensExpansion();
          }

          // Subsequent hold-drag frames keep the existing continuous behavior.
          requestAnimationFrame(() => {
            lensTrack.style.transitionDuration = '300ms';
          });

          return;
        }

        if (startLens && !lens.classList.contains('pressed')) {
          beginLensExpansion();
        }

        // During an already-active long press, the selector is hidden by the
        // ORIGINAL selector.pressed state. Keep its track physically together
        // with the lens while the finger moves.
        if (data.holdActivated) {
          selectorTrack.style.transitionDuration = '0ms';
          selectorTrack.style.transitionTimingFunction = '';
          selectorTrack.style.width = `${targetGeometry.width}px`;
          selectorTrack.style.transform = `translateX(${translateX}px)`;
        }

        // Original lens movement path.
        data.setTransform = `translateX(${visualTranslateX}px)`;
        startAnimation();
      }

      function unsetHighlightOnTouch() {
        cancelAnimationFrame(data.raf);
        data.setTransform = null;

        const next = data.newActiveIndex;

        if (data.holdActivated) {
          // Selector is still hidden by the ORIGINAL .pressed state.
          // Put it exactly at the destination BEFORE requestLensRelease()
          // removes .pressed and starts the normal selector fade-in.
          positionSelector(next, false);
          selectorTrack.style.transitionTimingFunction = '';
        }

        // Original lens lifecycle. No extra timers/classes/handoff logic.
        requestLensRelease();

        if (data.activeIndex !== next) {
          links[next].click();
          data.suppressNativeClick = true;
        }

        // For quick tap this is the original animated selector behavior.
        // For hold it is already at this exact position, so there is no run.
        positionSelector(next);
        positionLensTrack(next);
        lensTrack.style.transitionTimingFunction = '';
        revealTab(next);
      }


      function cancelPressIntent() {
        clearTimeout(data.pressIntentTimer);
        data.pressIntentTimer = null;
      }

      function classifyAsScroll() {
        cancelPressIntent();
        data.gesture = 'scroll';

        // Scroll can be chosen only while the gesture is still pending.
        // Once press mode starts, movement belongs to the lens until release.
        cancelLensForScroll();
        data.setTransform = null;
        stopAnimation();
        positionLensTrack(data.activeIndex, false);
      }

      function moveManualScroll(clientX) {
        const dx = clientX - data.touchStartX;
        const maxScroll = Math.max(0, tabStrip.scrollWidth - tabStrip.clientWidth);
        tabStrip.scrollLeft = Math.max(
          0,
          Math.min(maxScroll, data.touchStartScrollLeft - dx)
        );
      }

      function onPointer(e) {
        if (e.pointerType !== 'touch') return;

        if (e.type === 'pointerdown') {
          data.rect = tabStrip.getBoundingClientRect();
          data.touched = true;
          data.moved = false;
          data.gesture = 'pending';
          data.holdActivated = false;
          data.touchStartX = e.clientX;
          data.touchStartY = e.clientY;
          data.touchStartScrollLeft = tabStrip.scrollLeft;
          data.lastPointerX = e.clientX;

          // Short movement before timeout => scroll.
          // No movement until timeout => press/lens mode.
          cancelPressIntent();
          data.pressIntentTimer = setTimeout(() => {
            if (!data.touched || data.gesture !== 'pending') return;

            data.holdActivated = true;
            data.gesture = 'press';

            setHighlightOnTouch(
              { clientX: data.lastPointerX, clientY: e.clientY },
              { startLens: true, holdStart: true }
            );
          }, holdDelayMs);

          return;
        }

        if (e.type === 'pointermove') {
          if (!data.touched) return;

          data.lastPointerX = e.clientX;

          const dx = e.clientX - data.touchStartX;
          const dy = e.clientY - data.touchStartY;

          if (data.gesture === 'pending') {
            if (
              dx !== 0 &&
              Math.abs(dx) >= Math.abs(dy)
            ) {
              classifyAsScroll();
              moveManualScroll(e.clientX);
            }
            return;
          }

          if (data.gesture === 'scroll') {
            e.preventDefault();
            moveManualScroll(e.clientX);
            return;
          }

          if (data.gesture === 'press') {
            // Critical rule: after long-press activation, horizontal movement
            // controls the lens and can never switch this gesture to scrolling.
            e.preventDefault();
            data.moved = true;
            setHighlightOnTouch(e, { startLens: false });
          }
          return;
        }

        if (e.type === 'pointercancel') {
          data.touched = false;
          cancelPressIntent();
          cancelLensForScroll();
          data.gesture = 'idle';
          positionSelector(data.activeIndex, false);
          positionLensTrack(data.activeIndex, false);
          return;
        }
        if (e.type === 'pointerup' || e.type === 'pointercancel') {
          if (!data.touched) return;

          const wasScroll = data.gesture === 'scroll';
          const wasPress = data.gesture === 'press';

          data.touched = false;
          data.moved = false;
          cancelPressIntent();

          // A real finger tap almost always contains 1-3px of horizontal jitter.
          // Our zero-delay scroller intentionally starts moving on the first
          // horizontal pixel, so that tiny jitter can temporarily classify the
          // gesture as "scroll". But the click guard already considers scrolling
          // real only after >4px. Use the same threshold here.
          //
          // Result:
          //   1-4px micro-jitter -> still a tap -> lens appears;
          //   >4px movement      -> real scroll -> no lens.
          const scrollDistance = Math.abs(
            tabStrip.scrollLeft - data.touchStartScrollLeft
          );
          const wasRealScroll = wasScroll && scrollDistance > 4;

          if (wasRealScroll) {
            // Pure scroll gesture: no lens and no tab selection.
            data.holdActivated = false;
            data.gesture = 'idle';
            positionLensTrack(data.activeIndex, false);
            stopAnimation();
            return;
          }

          if (wasScroll) {
            // Micro-jitter only. Undo the tiny visual shift and continue through
            // the unchanged quick-tap path below.
            tabStrip.scrollLeft = data.touchStartScrollLeft;
          }

          if (!wasPress) {
            // Quick tap: preserve the existing v5 lens lifecycle.
            data.gesture = 'press';
            setHighlightOnTouch(e, { startLens: true });
          } else {
            setHighlightOnTouch(e, { startLens: false });
          }

          unsetHighlightOnTouch();
          data.holdActivated = false;
          data.gesture = 'idle';
          stopAnimation();
        }
      }

      listen(pane, 'pointerdown', onPointer);
      listen(document, 'pointermove', onPointer);
      listen(document, 'pointerup', onPointer);
      listen(document, 'pointercancel', onPointer);

      listen(pane, 'click', (e) => {
        if (data.suppressNativeClick && e.isTrusted) {
          data.suppressNativeClick = false;
          e.stopPropagation();
        }
      }, true);

      // Konsta Glass/useIosHighlight behavior for the outer ToolbarPane.
      function nextTick(fn) {
        requestAnimationFrame(() => requestAnimationFrame(fn));
      }

      function setGlassLightPosition(e) {
        const g = data.glass;
        if (!g.lightEl) return;
        const offsetX = e.clientX - g.rect.x;
        const offsetY = e.clientY - g.rect.y;
        g.lightEl.style.transform = `translate3d(${offsetX}px, ${offsetY}px, 0)`;
      }

      function removeGlassHighlight() {
        const g = data.glass;

        clearTimeout(g.showTimer);
        g.showTimer = null;
        g.pending = false;

        if (g.elScale) {
          g.elScale = false;
          pane.style.scale = '';

          const onTransitionEnd = () => {
            pane.style.transitionDuration = '';
            pane.style.transitionTimingFunction = '';
            pane.removeEventListener('transitionend', onTransitionEnd);
          };
          listen(pane, 'transitionend', onTransitionEnd);
        }

        if (g.lightElWrap) {
          const wrap = g.lightElWrap;
          if (wrap.style.opacity === '0') {
            wrap.remove();
          } else {
            listen(wrap, 'transitionend', () => wrap.remove(), { once: true });
            wrap.style.opacity = 0;
          }
        }

        g.lightEl = null;
        g.lightElWrap = null;
      }

      listen(pane, 'pointerenter', (e) => {
        const g = data.glass;
        g.rect = pane.getBoundingClientRect();

        const wrap = document.createElement('span');
        wrap.className = 'glass-light-wrap';

        const light = document.createElement('span');
        light.className = 'glass-light';

        const { width, height } = g.rect;
        const radius = Math.sqrt(width ** 2 + height ** 2);

        light.style.width = `${radius * 2}px`;
        light.style.height = `${radius * 2}px`;
        light.style.left = `${-radius}px`;
        light.style.top = `${-radius}px`;

        g.lightEl = light;
        g.lightElWrap = wrap;
        g.pointerType = e.pointerType;
        g.pending = e.pointerType !== 'mouse';

        setGlassLightPosition(e);
        wrap.appendChild(light);

        const showGlassHighlight = () => {
          if (!g.lightElWrap || !g.lightEl || !g.pending && e.pointerType !== 'mouse') {
            return;
          }

          if (!wrap.isConnected) {
            pane.appendChild(wrap);
          }

          if (e.pointerType !== 'mouse') {
            g.pending = false;
            g.elScale = true;
            const scale = (g.rect.width > 60 || g.rect.height > 60) ? 1.05 : 1.25;
            pane.style.scale = scale;
            pane.style.transitionDuration = '300ms';
            pane.style.transitionTimingFunction = 'ease-in-out';
          }

          nextTick(() => {
            if (wrap.isConnected) wrap.style.opacity = 1;
          });
        };

        if (e.pointerType === 'mouse') {
          // Preserve desktop hover behavior.
          showGlassHighlight();
        } else {
          // Touch: white light + container scale appear only after the same
          // delay that activates long-press. A slightly long normal tap no
          // longer flashes the glass effect.
          clearTimeout(g.showTimer);
          g.showTimer = setTimeout(showGlassHighlight, holdDelayMs);
        }
      });

      listen(pane, 'pointermove', setGlassLightPosition);
      listen(pane, 'pointerleave', removeGlassHighlight);

      // A touch can end while the pointer is still geometrically over the pane,
      // so pointerleave is not reliable enough to cancel a pending highlight.
      listen(document, 'pointerup', (e) => {
        if (e.pointerType !== 'mouse') removeGlassHighlight();
      });
      listen(document, 'pointercancel', (e) => {
        if (e.pointerType !== 'mouse') removeGlassHighlight();
      });


      selectIndex = index => updateActive(index, false);
      updateActive(initialIndex, false);
      requestAnimationFrame(() => {
        syncSlotWidths();
        positionSelector(data.activeIndex, false);
        positionLensTrack(data.activeIndex, false);
      });
      listen(host, 'tabs-layout-ready', () => {
        syncSlotWidths();
        positionSelector(data.activeIndex, false);
        positionLensTrack(data.activeIndex, false);
      });
      listen(window, 'resize', () => {
        syncSlotWidths();
        positionSelector(data.activeIndex, false);
        positionLensTrack(data.activeIndex, false);
      });
    })();


    (() => {
      try {
        const lens = document.getElementById('lens');
        const pane = document.getElementById('toolbar-pane');
        const filter = document.getElementById('standalone-lens-filter');
        if (!lens || !pane || !filter) return;

        const OPTICS = Object.freeze({
          neutralEdge: 1.7,
          rimWidth: 8,
          rimStrength: .67,
          trenchWidth: 1,
          trenchStrength: .09,
          centerStrength: 0,
          centerRadius: 1.02,
          bezelOpacity: .86,
          lensScale: 1.25,
          glassTint: .17,
          backdropBlur: 0,
          glassBrightness: 1.02,
          refraction: 8,
          rgbSpread: .1,
          padding: 51
        });

        function syncLensScaleWithContainer() {
          const containerScale =
            Number.parseFloat(pane.style.scale) || 1;

          const pressedScale =
            OPTICS.lensScale * containerScale;

          lens.style.setProperty(
            '--optical-pressed-scale',
            String(pressedScale)
          );
        }

        // The original v6 glass mechanics changes pane.style.scale to 1.05
        // during a long hold. Observe only that style change and mirror the
        // factor into the optical lens. No gesture/tap/scroll logic is changed.
        const paneScaleObserver = new MutationObserver(
          syncLensScaleWithContainer
        );

        paneScaleObserver.observe(
          pane,
          {
            attributes: true,
            attributeFilter: ['style']
          }
        );

        syncLensScaleWithContainer();

        filter.innerHTML = `
          <feImage
            id="optical-vector-image"
            x="0"
            y="0"
            width="1"
            height="1"
            preserveAspectRatio="none"
            result="vectorMap">
          </feImage>

          <feDisplacementMap
            id="optical-disp-r"
            in="SourceGraphic"
            in2="vectorMap"
            scale="8.1"
            xChannelSelector="R"
            yChannelSelector="G">
          </feDisplacementMap>
          <feColorMatrix
            type="matrix"
            result="redPass"
            values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0">
          </feColorMatrix>

          <feDisplacementMap
            id="optical-disp-g"
            in="SourceGraphic"
            in2="vectorMap"
            scale="8"
            xChannelSelector="R"
            yChannelSelector="G">
          </feDisplacementMap>
          <feColorMatrix
            type="matrix"
            result="greenPass"
            values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0">
          </feColorMatrix>

          <feDisplacementMap
            id="optical-disp-b"
            in="SourceGraphic"
            in2="vectorMap"
            scale="7.9"
            xChannelSelector="R"
            yChannelSelector="G">
          </feDisplacementMap>
          <feColorMatrix
            type="matrix"
            result="bluePass"
            values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0">
          </feColorMatrix>

          <feBlend
            in="redPass"
            in2="greenPass"
            mode="screen"
            result="rg">
          </feBlend>
          <feBlend
            in="rg"
            in2="bluePass"
            mode="screen">
          </feBlend>
        `;

        const vectorImage =
          document.getElementById('optical-vector-image');
        const dispR =
          document.getElementById('optical-disp-r');
        const dispG =
          document.getElementById('optical-disp-g');
        const dispB =
          document.getElementById('optical-disp-b');

        const work = document.createElement('canvas');
        const ctx = work.getContext(
          '2d',
          { willReadFrequently: true }
        );

        const clamp = (v,a,b) =>
          Math.max(a,Math.min(b,v));

        function roundedRectSdf(
          x,y,halfW,halfH,r
        ) {
          const qx =
            Math.abs(x)-(halfW-r);
          const qy =
            Math.abs(y)-(halfH-r);
          const ox = Math.max(qx,0);
          const oy = Math.max(qy,0);

          return Math.hypot(ox,oy) +
            Math.min(Math.max(qx,qy),0) - r;
        }

        function buildVectorMap() {
          if (!ctx) return;
          /* Same rule as the successful standalone lens:
             map uses the untransformed local lens box. */
          const width =
            Math.max(1,lens.offsetWidth);
          const height =
            Math.max(1,lens.offsetHeight);
          const radius =
            Math.min(width,height)/2;

          const sampleScale =
            Math.max(
              1.5,
              Math.min(
                3,
                window.devicePixelRatio || 1.5
              )
            );

          const w =
            Math.max(
              128,
              Math.round(width*sampleScale)
            );

          const h =
            Math.max(
              72,
              Math.round(height*sampleScale)
            );

          work.width = w;
          work.height = h;

          const sx = w/width;
          const sy = h/height;
          const halfW = width/2;
          const halfH = height/2;

          const image =
            ctx.createImageData(w,h);
          const data = image.data;
          const eps = .35;

          for (let j=0; j<h; j++) {
            const y =
              (j+.5)/sy-halfH;

            for (let i=0; i<w; i++) {
              const x =
                (i+.5)/sx-halfW;

              const sdf =
                roundedRectSdf(
                  x,y,
                  halfW,halfH,
                  radius
                );

              const d = -sdf;

              let vx = 0;
              let vy = 0;

              if (d > OPTICS.neutralEdge) {
                const gx =
                  roundedRectSdf(
                    x+eps,y,
                    halfW,halfH,
                    radius
                  ) -
                  roundedRectSdf(
                    x-eps,y,
                    halfW,halfH,
                    radius
                  );

                const gy =
                  roundedRectSdf(
                    x,y+eps,
                    halfW,halfH,
                    radius
                  ) -
                  roundedRectSdf(
                    x,y-eps,
                    halfW,halfH,
                    radius
                  );

                const gl =
                  Math.hypot(gx,gy) || 1;

                const nx = gx/gl;
                const ny = gy/gl;
                const local =
                  d-OPTICS.neutralEdge;

                let magnitude = 0;

                if (
                  local < OPTICS.rimWidth
                ) {
                  const t =
                    local/OPTICS.rimWidth;

                  magnitude +=
                    Math.sin(Math.PI*t) *
                    OPTICS.rimStrength;
                }

                if (
                  local >= OPTICS.rimWidth &&
                  local <
                    OPTICS.rimWidth +
                    OPTICS.trenchWidth
                ) {
                  const t =
                    (local-OPTICS.rimWidth) /
                    Math.max(
                      .001,
                      OPTICS.trenchWidth
                    );

                  magnitude -=
                    Math.sin(Math.PI*t) *
                    OPTICS.trenchStrength;
                }

                vx = nx*magnitude;
                vy = ny*magnitude;
              }

              const p = (j*w+i)*4;

              data[p] =
                Math.round(
                  clamp(
                    128+vx*127,
                    0,255
                  )
                );

              data[p+1] =
                Math.round(
                  clamp(
                    128+vy*127,
                    0,255
                  )
                );

              data[p+2] = 128;
              data[p+3] = 255;
            }
          }

          ctx.putImageData(
            image,
            0,0
          );

          vectorImage.setAttribute(
            'href',
            work.toDataURL('image/png')
          );

          vectorImage.setAttribute(
            'width',
            String(width)
          );

          vectorImage.setAttribute(
            'height',
            String(height)
          );

          const scale =
            OPTICS.refraction;

          const spread =
            OPTICS.rgbSpread;

          dispR.setAttribute(
            'scale',
            String(scale+spread)
          );

          dispG.setAttribute(
            'scale',
            String(scale)
          );

          dispB.setAttribute(
            'scale',
            String(
              Math.max(
                0,
                scale-spread
              )
            )
          );

          const pad = OPTICS.padding;

          filter.setAttribute(
            'x',
            `${-pad}%`
          );

          filter.setAttribute(
            'y',
            `${-pad}%`
          );

          filter.setAttribute(
            'width',
            `${100+pad*2}%`
          );

          filter.setAttribute(
            'height',
            `${100+pad*2}%`
          );
        }

        requestAnimationFrame(
          () =>
            requestAnimationFrame(
              buildVectorMap
            )
        );

        new ResizeObserver(
          buildVectorMap
        ).observe(lens);

        listen(window,
          'resize',
          buildVectorMap,
          { passive:true }
        );
      } catch (error) {
        console.error(
          'Upper optical Tabs init failed:',
          error
        );
      }
    })();


    (() => {
      try {
        const pane = document.getElementById('toolbar-pane');
        const tabStrip = document.getElementById('tab-strip');
        const lensTrack = document.getElementById('lens-track');
        const lens = document.getElementById('lens');
        const selector = document.getElementById('selector');
        const holdDelayInput = { value: 140 };
        const links = [...tabStrip.querySelectorAll(':scope > .tab-link')];

        const playground = pane.closest('.optical-tabs-playground');

        if (!pane || !tabStrip || !lensTrack || !lens || !selector || !playground || !links.length) return;

        const DEFAULTS = Object.freeze({
          duration: 600,
          lead: 90,
          p1Time: 78,
          p2Time: 479,

          x1: .92,
          x2: 1.02,
          y1: 1.09,
          y2: .99,

          // User-tuned spring curve, current approved values.
          xBend1: .88,
          xBend2: 1.03,
          yBend1: 1.14,
          yBend2: .98
        });

        const state = { ...DEFAULTS };

        let pointerId = null;
        let pointerDownAt = 0;
        let pointerStartX = 0;
        let pointerStartY = 0;
        let startScrollLeft = 0;
        let armedCleanup = null;
        let springAnimation = null;

        let tapTravelScaleActive = false;
        let paneResetCleanup = null;
        let lensPositionRaf = 0;

        const clamp = (v,a,b) =>
          Math.max(a,Math.min(b,v));

        function trackTranslateX() {
          const matrix = getComputedStyle(lensTrack).transform;

          if (!matrix || matrix === 'none') {
            return 0;
          }

          try {
            return new DOMMatrixReadOnly(matrix).m41;
          } catch (_) {
            const match = matrix.match(
              /^matrix\(([^)]+)\)$/
            );

            if (!match) return 0;

            const parts =
              match[1]
              .split(',')
              .map(Number);

            return parts[4] || 0;
          }
        }

        function updateLensHorizontalMapping() {


          const rawCenter =
            trackTranslateX() +
            lensTrack.offsetWidth/2;

          const width =
            playground.clientWidth;

          // Selector lives INSIDE the pane, so when pane scales around its
          // center the extreme slot centers move outward.
          //
          // Lens lives in a sibling overlay, therefore its X coordinate must
          // receive the same scale transform explicitly:
          //
          //   visualX = C + (rawX - C) * scale
          //   correction = (rawX - C) * (scale - 1)
          //
          // At the first slot correction is negative, so the lens track is
          // allowed to move beyond the left edge instead of stopping at x=0.
          // Right edge is symmetric.
          const paneRect =
            pane.getBoundingClientRect();

          const basePaneWidth =
            Math.max(1, pane.offsetWidth);

          const livePaneScale =
            paneRect.width / basePaneWidth;

          const paneCenter =
            basePaneWidth / 2;

          const scaleCorrection =
            (rawCenter - paneCenter) *
            (livePaneScale - 1);

          lensTrack.style.left =
            `${scaleCorrection}px`;

          const visualCenter =
            rawCenter + scaleCorrection;

          lensPositionRaf =
            requestAnimationFrame(
              updateLensHorizontalMapping
            );
        }

        function bendHandleTime(point) {
          const { index } = point;
          if (index === 1) {
            const room = state.p2Time-state.p1Time;
            return state.p1Time +
              Math.min(46, Math.max(18, room*.34));
          }

          const room = state.duration-state.p2Time;
          return state.p2Time +
            Math.min(46, Math.max(18, room*.42));
        }

        function tangentAt(axis,index) {
          const amp =
            axis === 'x'
              ? state[`x${index}`]
              : state[`y${index}`];

          const bend =
            axis === 'x'
              ? state[`xBend${index}`]
              : state[`yBend${index}`];

          const pointTime =
            index === 1
              ? state.p1Time
              : state.p2Time;

          const handleTime =
            bendHandleTime({ index });

          return (bend-amp) /
            Math.max(1,handleTime-pointTime);
        }

        function hermite(
          time,
          t0,y0,m0,
          t1,y1,m1
        ) {
          const dt = Math.max(1,t1-t0);
          const u = clamp(
            (time-t0)/dt,
            0,
            1
          );

          const u2 = u*u;
          const u3 = u2*u;

          const h00 = 2*u3-3*u2+1;
          const h10 = u3-2*u2+u;
          const h01 = -2*u3+3*u2;
          const h11 = u3-u2;

          return (
            h00*y0 +
            h10*dt*m0 +
            h01*y1 +
            h11*dt*m1
          );
        }

        function curveValue(axis,time) {
          const v1 =
            axis === 'x'
              ? state.x1
              : state.y1;

          const v2 =
            axis === 'x'
              ? state.x2
              : state.y2;

          const m1 = tangentAt(axis,1);
          const m2 = tangentAt(axis,2);

          if (time <= state.p1Time) {
            return hermite(
              time,
              0,1,0,
              state.p1Time,v1,m1
            );
          }

          if (time <= state.p2Time) {
            return hermite(
              time,
              state.p1Time,v1,m1,
              state.p2Time,v2,m2
            );
          }

          return hermite(
            time,
            state.p2Time,v2,m2,
            state.duration,1,0
          );
        }

        function clearPaneResetCleanup() {
          if (paneResetCleanup) {
            paneResetCleanup();
            paneResetCleanup = null;
          }
        }

        function expandContainerForTapTravel() {
          clearPaneResetCleanup();
          tapTravelScaleActive = true;

          // Same container enlargement as the existing long-hold behavior.
          pane.style.transitionDuration = '300ms';
          pane.style.transitionTimingFunction = 'ease-in-out';
          pane.style.scale = '1.05';
        }

        function restoreContainerWithSelector() {
          if (!tapTravelScaleActive) return;

          tapTravelScaleActive = false;
          clearPaneResetCleanup();

          // Selector fade-in and container shrink start in the SAME frame and
          // both use the existing 300ms visual cadence.
          pane.style.transitionDuration = '300ms';
          pane.style.transitionTimingFunction = 'ease-in-out';
          pane.style.scale = '';

          let done = false;

          const cleanup = () => {
            if (done) return;
            done = true;
            pane.removeEventListener('transitionend', onTransitionEnd);
            clearTimeout(fallbackTimer);
            pane.style.transitionDuration = '';
            pane.style.transitionTimingFunction = '';
            paneResetCleanup = null;
          };

          const onTransitionEnd = event => {
            if (event.target !== pane) return;
            cleanup();
          };

          const fallbackTimer = setTimeout(cleanup, 340);
          listen(pane, 'transitionend', onTransitionEnd);
          paneResetCleanup = cleanup;
        }

        function holdLensForSpring() {
          lens.classList.add(
            'tap-spring-active'
          );
          selector.classList.add(
            'tap-spring-hidden'
          );
        }

        function releaseLensAfterSpring() {
          lens.classList.remove(
            'tap-spring-active'
          );

          // Same frame: selector starts appearing and the whole container
          // starts returning from 1.05 to 1.00.
          selector.classList.remove(
            'tap-spring-hidden'
          );
          restoreContainerWithSelector();
        }

        function cancelRunningSpring(
          { release=true }={}
        ) {
          if (springAnimation) {
            springAnimation.cancel();
            springAnimation = null;
          }

          if (release) {
            releaseLensAfterSpring();
          }
        }

        function cancelArmedSpring(
          { release=true }={}
        ) {
          if (armedCleanup) {
            armedCleanup();
            armedCleanup = null;
          }

          if (release) {
            releaseLensAfterSpring();
          }
        }

        function sampledSpringKeyframes() {
          const samples = 64;
          const frames = [];

          for (
            let i=0;
            i<=samples;
            i++
          ) {
            const time =
              state.duration*
              (i/samples);

            frames.push({
              transform:
                `scale(${curveValue('x',time).toFixed(4)}, ${curveValue('y',time).toFixed(4)})`,
              offset:
                i/samples
            });
          }

          return frames;
        }

        function playTapSpring() {
          cancelRunningSpring({
            release:false
          });

          holdLensForSpring();

          springAnimation =
            animate(lens,
              sampledSpringKeyframes(),
              {
                duration:
                  state.duration,
                fill:'none',
                easing:'linear'
              }
            );

          listen(springAnimation,
            'finish',
            () => {
              springAnimation = null;
              releaseLensAfterSpring();
            },
            { once:true }
          );

          listen(springAnimation,
            'cancel',
            () => {
              springAnimation = null;
            },
            { once:true }
          );
        }

        function nearestTabIndex(
          clientX
        ) {
          const rect =
            tabStrip.getBoundingClientRect();

          const contentX =
            clientX -
            rect.left +
            tabStrip.scrollLeft;

          let bestIndex = 0;
          let bestDistance = Infinity;

          links.forEach(
            (link,index) => {
              const center =
                link.offsetLeft +
                link.offsetWidth/2;

              const distance =
                Math.abs(
                  center-contentX
                );

              if (
                distance <
                bestDistance
              ) {
                bestDistance =
                  distance;
                bestIndex = index;
              }
            }
          );

          return bestIndex;
        }

        function transitionDurationMs(
          element
        ) {
          const style =
            getComputedStyle(element);

          const raw =
            style.transitionDuration
            .split(',')[0]
            .trim();

          if (raw.endsWith('ms')) {
            return (
              Number.parseFloat(raw) ||
              0
            );
          }

          if (raw.endsWith('s')) {
            return (
              Number.parseFloat(raw) ||
              0
            )*1000;
          }

          return (
            Number.parseFloat(raw) ||
            0
          );
        }

        function armSpringBeforeArrival() {
          cancelArmedSpring({
            release:false
          });

          // Capture-phase pointerup reaches this before the original v6
          // pointerup handler starts horizontal movement. Scale the whole
          // container immediately; the optics observer multiplies the lens
          // scale by the same 1.05 factor.
          expandContainerForTapTravel();
          holdLensForSpring();

          let startTimer = null;
          let fallbackTimer = null;
          let rafId = 0;
          let didRun = false;

          const cleanup = () => {
            cancelAnimationFrame(rafId);
            clearTimeout(startTimer);
            clearTimeout(fallbackTimer);
          };

          const run = () => {
            if (didRun) return;
            didRun = true;
            cleanup();
            armedCleanup = null;
            playTapSpring();
          };

          rafId =
            requestAnimationFrame(
              () => {
                const travelMs =
                  transitionDurationMs(
                    lensTrack
                  ) || 300;

                const startAfterMs =
                  Math.max(
                    0,
                    travelMs -
                    state.lead
                  );

                startTimer =
                  setTimeout(
                    run,
                    startAfterMs
                  );

                fallbackTimer =
                  setTimeout(
                    run,
                    travelMs+40
                  );
              }
            );

          armedCleanup = cleanup;
        }

        listen(pane,
          'pointerdown',
          event => {
            if (
              event.pointerType !==
              'touch'
            ) {
              return;
            }

            cancelArmedSpring();
            cancelRunningSpring();
            restoreContainerWithSelector();

            pointerId =
              event.pointerId;

            pointerDownAt =
              performance.now();

            pointerStartX =
              event.clientX;

            pointerStartY =
              event.clientY;

            startScrollLeft =
              tabStrip.scrollLeft;
          },
          { capture:true }
        );

        listen(document,
          'pointerup',
          event => {
            if (
              event.pointerType !==
              'touch'
            ) {
              return;
            }

            if (
              event.pointerId !==
              pointerId
            ) {
              return;
            }

            const elapsed =
              performance.now() -
              pointerDownAt;

            const holdDelay =
              Number(
                holdDelayInput?.value ||
                140
              );

            const dx =
              Math.abs(
                event.clientX -
                pointerStartX
              );

            const dy =
              Math.abs(
                event.clientY -
                pointerStartY
              );

            const scrollDistance =
              Math.abs(
                tabStrip.scrollLeft -
                startScrollLeft
              );

            pointerId = null;

            const isQuickTap =
              elapsed < holdDelay &&
              dx <= 6 &&
              dy <= 10 &&
              scrollDistance <= 4;

            if (!isQuickTap) return;

            const currentIndex =
              links.findIndex(
                link =>
                  link.classList.contains(
                    'active'
                  )
              );

            const targetIndex =
              nearestTabIndex(
                event.clientX
              );

            if (
              targetIndex ===
              currentIndex
            ) {
              return;
            }

            armSpringBeforeArrival();
          },
          { capture:true }
        );

        listen(document,
          'pointercancel',
          event => {
            if (
              event.pointerId !==
              pointerId
            ) {
              return;
            }

            pointerId = null;
            cancelArmedSpring();
            cancelRunningSpring();
            restoreContainerWithSelector();
          },
          { capture:true }
        );

        const iconAnimations = new WeakMap();

        function playActiveIconSpring(index) {
          const link = links[index];
          const iconWrap = link?.querySelector('.tab-icon-wrap');
          if (!iconWrap) return;

          iconAnimations.get(iconWrap)?.cancel();

          const travelMs =
            transitionDurationMs(lensTrack) || 300;

          const restoreMs = 300;

          // Active class changes at selection time. The container then:
          // 1) travels until spring start: travel - lead
          // 2) runs the tuned 600ms spring
          // 3) returns to base scale during the 300ms selector handoff
          //
          // Make the icon spring finish on that same final frame.
          const totalMs = Math.max(
            360,
            (travelMs - state.lead) +
              state.duration +
              restoreMs
          );

          const animation = animate(iconWrap,
            [
              {
                transform: 'scale(1)',
                offset: 0,
                easing: 'cubic-bezier(.18,.75,.22,1)'
              },
              {
                transform: 'scale(1.16)',
                offset: .16,
                easing: 'cubic-bezier(.16,.9,.22,1)'
              },
              {
                transform: 'scale(.94)',
                offset: .34,
                easing: 'cubic-bezier(.20,.82,.26,1)'
              },
              {
                transform: 'scale(1.055)',
                offset: .53,
                easing: 'cubic-bezier(.18,.82,.24,1)'
              },
              {
                transform: 'scale(.985)',
                offset: .72,
                easing: 'cubic-bezier(.2,.78,.25,1)'
              },
              {
                transform: 'scale(1.012)',
                offset: .86,
                easing: 'ease-out'
              },
              {
                transform: 'scale(1)',
                offset: 1
              }
            ],
            {
              duration: totalMs,
              fill: 'none',
              easing: 'linear'
            }
          );

          iconAnimations.set(iconWrap, animation);

          listen(animation,
            'finish',
            () => {
              if (iconAnimations.get(iconWrap) === animation) {
                iconAnimations.delete(iconWrap);
              }
            },
            { once: true }
          );
        }

        listen(window,
          'mezfit-tab-active-change',
          (event) => {
            playActiveIconSpring(
              event.detail?.index
            );
          }
        );

        updateLensHorizontalMapping();
      } catch (error) {
        console.error(
          'Extracted tabbar spring init failed:',
          error
        );
      }
    })();

  const iconMask=document.getElementById('iconMask');
  const iconLayer=host, shape=document.getElementById('shape'), motion=document.getElementById('motion'), scaleEl=document.getElementById('scale');
  const preview=root.host;
  const zoomVector=document.getElementById('zoom-vector-image'),iconFilter=document.getElementById('icon-displacement-filter'),zoomDisp=document.getElementById('zoom-displacement');
  const D=1200;
  let currentScaleX=1,currentScaleY=1,zoomMapRAF=0,lastZoomState='';
  const mapClamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function timing(){return {d:580,op:.21,lo:.75,startPct:80,lowPx:19,springMs:230}}
const ZOOM={
  visible:true,
  width:132,
  strengthX:12,
  strengthY:17.5,
  edgeOffset:0,
  padding:160,
  exitMs:280,
  nodes:[
    {x:0,y:0},
    {x:.21,y:.88},
    {x:.47,y:1},
    {x:.78,y:.88},
    {x:1,y:0}
  ]
};
const n=[{t:0,s:1.25,f:1},{t:330,s:1.18},{t:779.7970246696906,s:1.0809331587587891},{t:1200,s:1,f:1}],c=[[{t:90,s:1.25},{t:230,s:1.22}],[{t:450,s:1.14},{t:693.8062003295811,s:0.8612479021258022}],[{t:889.7970246696907,s:1.055933158758789},{t:1110,s:1}]],yn=[{t:0,s:1.25,f:1},{t:330,s:1.18},{t:878.825189690977,s:0.8},{t:1200,s:1,f:1}],yc=[[{t:90,s:1.25},{t:230,s:1.22}],[{t:450,s:1.14},{t:738.825189690977,s:0.8300000000000001}],[{t:988.8251896909766,s:0.8},{t:1110,s:1}]];
function catmull(v0,v1,v2,v3,t){
  const t2=t*t,t3=t2*t;
  return .5*((2*v1)+(-v0+v2)*t+(2*v0-5*v1+4*v2-v3)*t2+(-v0+3*v1-3*v2+v3)*t3);
}
function profileSample(nodes,x){
  x=mapClamp(x,0,1);
  let i=0;while(i<nodes.length-2&&x>nodes[i+1].x)i++;
  const a=nodes[Math.max(0,i-1)],b=nodes[i],c=nodes[i+1],d=nodes[Math.min(nodes.length-1,i+2)];
  const span=Math.max(.0001,c.x-b.x),t=mapClamp((x-b.x)/span,0,1);
  return catmull(a.y,b.y,c.y,d.y,t);
}
function fullStripWidth(){
  const css=getComputedStyle(document.documentElement).getPropertyValue('--runtime-tabs-width').trim();
  const n=parseFloat(css);
  return Number.isFinite(n)&&n>0?n:Math.max(64,preview.clientWidth-16);
}
function visibleContainerWidth(){
  const w=parseFloat(getComputedStyle(iconMask).width);
  return Number.isFinite(w)&&w>0?w:64;
}
function zoomCenters(elapsed,mainDuration,lowFraction){
  const fw=fullStripWidth(),cw=visibleContainerWidth(),halfLens=ZOOM.width/2;
  const lowTime=mainDuration*lowFraction;

  // Phase 1: while the container is opening, both lenses follow its current edges.
  if(elapsed<=lowTime){
    const edge=cw/2;
    return {
      left:-edge-ZOOM.edgeOffset,
      right:edge+ZOOM.edgeOffset,
      done:false
    };
  }

  // Phase 2: from the exact low point onward there is NO pause.
  // The lenses immediately continue outward at constant speed.
  // They keep moving through the return Y phase and continue after the main animation.
  const startLeft=-fw/2-ZOOM.edgeOffset;
  const startRight=fw/2+ZOOM.edgeOffset;
  const exitDistance=fw/2+halfLens+16;

  const travelDuration=Math.max(1,(mainDuration-lowTime)+ZOOM.exitMs);
  const p=mapClamp((elapsed-lowTime)/travelDuration,0,1);

  const left=startLeft+(-exitDistance-startLeft)*p;
  const right=startRight+(exitDistance-startRight)*p;

  return {
    left,
    right,
    done:p>=1
  };
}
function createNeutralCanvas(width,height){
  const c=document.createElement('canvas');c.width=width;c.height=height;
  const ctx=c.getContext('2d',{willReadFrequently:true});
  if (!ctx) return null;
  ctx.fillStyle='rgb(128,128,128)';ctx.fillRect(0,0,width,height);
  return {canvas:c,ctx};
}
function rebuildZoomMap(centers){
  zoomMapRAF=0;
  const fw=Math.max(64,Math.round(fullStripWidth())),h=64;
  const state=[fw,centers.left.toFixed(2),centers.right.toFixed(2),ZOOM.width,ZOOM.strengthX,ZOOM.strengthY,
    ZOOM.nodes.map(p=>p.x.toFixed(3)+':'+p.y.toFixed(3)).join(',')].join('|');
  if(state===lastZoomState)return;
  lastZoomState=state;

  const full=createNeutralCanvas(fw,h);
  if (!full) return;
  const ctx=full.ctx;
  const img=ctx.createImageData(fw,h),d=img.data;
  const cy=h/2,rx=Math.max(1,ZOOM.width/2),ry=h/2;
  const centersPx=[fw/2+centers.left,fw/2+centers.right];

  // Compose both lenses into ONE displacement field by summing vectors.
  // This is order-independent and preserves exact left/right symmetry in overlap.
  for(let y=0;y<h;y++){
    for(let x=0;x<fw;x++){
      let dx=0,dy=0;
      for(const cx of centersPx){
        const nx=(x+.5-cx)/rx;
        const ny=(y+.5-cy)/Math.max(1,ry);
        const r=Math.hypot(nx,ny);
        if(r>1)continue;

        const amp=profileSample(ZOOM.nodes,r);
        const ux=r>1e-5?nx/r:0;
        const uy=r>1e-5?ny/r:0;

        dx+=-ux*amp*ZOOM.strengthX;
        dy+=-uy*amp*ZOOM.strengthY;
      }

      const p=(y*fw+x)*4;
      d[p]=Math.round(mapClamp(128+dx/64*255,0,255));
      d[p+1]=Math.round(mapClamp(128+dy/64*255,0,255));
      d[p+2]=128;
      d[p+3]=255;
    }
  }
  ctx.putImageData(img,0,0);



  const url=full.canvas.toDataURL('image/png');
  zoomVector.setAttribute('href',url);
  zoomVector.setAttributeNS('http://www.w3.org/1999/xlink','href',url);
  zoomVector.setAttribute('x','0');
  zoomVector.setAttribute('y','0');
  zoomVector.setAttribute('width',String(fw));
  zoomVector.setAttribute('height','64');

  const pad=Math.max(100,ZOOM.padding);
  iconFilter.setAttribute('x',-pad+'%');
  iconFilter.setAttribute('y',-pad+'%');
  iconFilter.setAttribute('width',(100+2*pad)+'%');
  iconFilter.setAttribute('height',(100+2*pad)+'%');
  zoomDisp.setAttribute('scale','64');
}
function queueZoomMap(centers){
  if(zoomMapRAF)cancelAnimationFrame(zoomMapRAF);
  zoomMapRAF=requestAnimationFrame(()=>rebuildZoomMap(centers));
}
function bez(a,b,c,d,u){let v=1-u;return v*v*v*a+3*v*v*u*b+3*v*u*u*c+u*u*u*d}
function sampleScaleY(t){
  let k=0;while(k<2&&t>yn[k+1].t)k++;
  let a=yn[k],b=yn[k+1],cc=yc[k],lo=0,hi=1,u=.5;
  for(let q=0;q<20;q++){u=(lo+hi)/2;if(bez(a.t,cc[0].t,cc[1].t,b.t,u)<t)lo=u;else hi=u}
  return bez(a.s,cc[0].s,cc[1].s,b.s,u)
}
function sampleScale(t){let k=0;while(k<2&&t>n[k+1].t)k++;let a=n[k],b=n[k+1],cc=c[k],lo=0,hi=1,u=.5;for(let q=0;q<20;q++){u=(lo+hi)/2;if(bez(a.t,cc[0].t,cc[1].t,b.t,u)<t)lo=u;else hi=u}return bez(a.s,cc[0].s,cc[1].s,b.s,u)}
function timelineDuration(){
  const st=timing();
  return st.d+Math.max(ZOOM.exitMs,st.springMs);
}
function applyDirectScale(sx,sy){
  currentScaleX=sx;
  currentScaleY=sy;
  // The wrapper remains transform-neutral. Scale is applied directly to the
  // real animated geometry so the glass container cannot be bypassed.
  scaleEl.style.transform='none';
  shape.style.transform=`translate(-50%,-50%) scale(${sx},${sy})`;
  iconMask.style.transform=`translate(-50%,-50%) scale(${sx},${sy})`;
}
function renderScaleAt(ms,st){
  const t=mapClamp(ms,0,timelineDuration());

  if(t<=st.d){
    const curveT=(t/st.d)*D;
    applyDirectScale(sampleScale(curveT),sampleScaleY(curveT));
    return;
  }

  const sp=mapClamp((t-st.d)/Math.max(1,st.springMs),0,1);
  let v=1;
  if(sp<=.5)v=1-(.04*(sp/.5));
  else v=.96+(.04*((sp-.5)/.5));
  applyDirectScale(v,v);
}
function renderYAt(ms,st){
  const t=mapClamp(ms,0,timelineDuration());

  if(t<=st.d){
    const lowTime=Math.max(1,st.d*st.lo);
    const startY=-(st.startPct/100*64+32);

    if(t<=lowTime){
      const u=mapClamp(t/lowTime,0,1);
      const y=startY+(st.lowPx-startY)*u;
      motion.style.transform=`translateY(${y}px)`;
    }else{
      const u=mapClamp((t-lowTime)/Math.max(1,st.d-lowTime),0,1);
      const y=st.lowPx*(1-u);
      motion.style.transform=`translateY(${y}px)`;
    }
    return;
  }

  motion.style.transform='translateY(0px)';
}
function renderIconsAt(ms,st){
  const showAt=st.d*st.op;
  iconLayer.style.opacity=ms>=showAt?'1':'0';
  const ready=ms>=timelineDuration();
  const changed=iconMask.classList.contains('tabs-interactive')!==ready;
  iconMask.classList.toggle('tabs-interactive',ready);
  shape.classList.toggle('tabs-replaced',ready);
  iconLayer.toggleAttribute('startup',!ready);
  iconLayer.inert=!ready;
  if(changed && ready) iconLayer.dispatchEvent(new Event('tabs-layout-ready'));

}

  function size() {
    const width=root.host.clientWidth/1.1;
    root.host.style.setProperty('--runtime-tabs-width',width+'px');
    return width;
  }
  function settle() {
    const width=size();
    shape.style.width=iconMask.style.width=width+'px';
    renderScaleAt(timelineDuration(),timing());
    renderYAt(timelineDuration(),timing());
    renderIconsAt(timelineDuration(),timing());
    window.dispatchEvent(new Event('resize'));
  }
  let running = false;
  function play() {
    const st=timing(),fw=size(),rem=st.lo-st.op;
    const wf=[{offset:0,width:'64px'},{offset:st.op,width:'64px'},
      {offset:st.op+rem*.30,width:(64+(fw-64)*.22)+'px'},
      {offset:st.op+rem*.62,width:(64+(fw-64)*.62)+'px'},
      {offset:st.op+rem*.92,width:(64+(fw-64)*.94)+'px'},
      {offset:st.lo,width:fw+'px'},{offset:1,width:fw+'px'}];
    const opening=[animate(shape,wf,{duration:st.d,easing:'linear',fill:'forwards'}),animate(iconMask,wf,{duration:st.d,easing:'linear',fill:'forwards'})];
    const start=performance.now(),total=timelineDuration();running=true;
    function frame(now){
      const elapsed=Math.min(total,now-start);
      renderScaleAt(elapsed,st);renderYAt(elapsed,st);renderIconsAt(elapsed,st);
      queueZoomMap(zoomCenters(elapsed,st.d,st.lo));
      if(elapsed<total)requestAnimationFrame(frame);
      else { running=false; opening.forEach(a=>a.cancel());settle(); }
    }
    frame(start);
  }
  // Pointer lifecycle ends only after all prototype handlers have seen pointerup/cancel.
  listen(document,'pointerup',()=>{pointerId=null});
  listen(document,'pointercancel',()=>{pointerId=null});
  let lastWidth=0;
  const resize=new ResizeObserver(()=>{
    if(root.host.clientWidth===lastWidth)return;
    lastWidth=root.host.clientWidth;
    if(!running)settle();
  });resize.observe(root.host);
  if(playEntrance && !(owner.defaultView.matchMedia?.('(prefers-reduced-motion: reduce)').matches))play();else settle();
  return {
    setValue(index){selectIndex(index)},
    dispose(){
      disposed=true;
      timers.forEach(id=>globalThis.clearTimeout(id));frames.forEach(id=>globalThis.cancelAnimationFrame(id));
      observers.forEach(observer=>observer.disconnect());animations.forEach(animation=>animation.cancel());
      disposers.forEach(dispose=>dispose());
      if(pointerId!==null && paneElement.hasPointerCapture?.(pointerId))paneElement.releasePointerCapture(pointerId);
    },
  };
}
