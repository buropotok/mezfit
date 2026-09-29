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
            if (host.hasAttribute('startup')) return;
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
  const iconLayer=host;
  const scene=document.getElementById('startupScene');
  const vector=document.getElementById('startup-vector');
  const vectorNoBlur=document.getElementById('startup-vector-no-blur');
  const maskSurface=document.getElementById('startup-mask-surface');
  const bezelSurface=document.getElementById('startup-bezel-surface');
  const iconsFo=document.getElementById('startup-icons-fo');
  const materialSurface=document.getElementById('startup-material-surface');
  const backdropLayer=document.getElementById('startup-backdrop-layer');
  const saturationNode=document.getElementById('startup-lens-saturation');
  const refraction=document.getElementById('startup-refraction-icons');
  const SETTINGS={
    pauseSec:.30,
    revealSec:.75,
    handoffSec:.16,
    speed:500,
    lensScale:1.14,
    blurPx:.7,
    saturation:1.29,
    frost:.14,
    speedPoints:[0,.186,.360,.577,0],
  };
  const threshold=.46,logThreshold=-Math.log(threshold),nodes=[{x:0,y:0},{x:.21,y:.88},{x:.47,y:1},{x:.78,y:.88},{x:1,y:0}];
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  let width=0,height=64,baseY=32,sigma=36,bx=0,by=32,cx=0,cy=32,timing=null,path=[],splitU=null;
  let running=false,startTime=0,handoffProgress=0,bezelFrame=0;
  const mapCanvas=document.createElement('canvas'),mapCtx=mapCanvas.getContext('2d',{willReadFrequently:true});
  const bezelCanvas=document.createElement('canvas'),bezelCtx=bezelCanvas.getContext('2d',{willReadFrequently:true});
  const speedIntegral=new Float32Array(257),fieldAmpLookup=new Float32Array(2049),profileLookup=new Float32Array(1025);
  let fieldAmpLookupReady=false;

  function baseSigma(){return Math.max(12,Math.min(40,width/8));}
  function applyLensSize(){sigma=SETTINGS.lensScale*baseSigma();}
  function halfSpan(){return Math.max(1,width/2/1.1-32);}
  function movingSigma(x){
    const t=clamp(x/halfSpan(),0,1),blend=t*t*(3-2*t),finalSigma=32/Math.sqrt(2*Math.log(2/threshold));
    return sigma+(finalSigma-sigma)*blend;
  }
  function bridgeWeight(x){
    const a=clamp(x/halfSpan(),0,1),smooth=a*a*(3-2*a);
    return Math.max(smooth,.28*(1-Math.exp(-x*x/(2*movingSigma(x)**2))));
  }
  function catmull1D(a,b,c,d,t){
    const t2=t*t,t3=t2*t;
    return .5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t2+(-a+3*b-3*c+d)*t3);
  }
  function speedValueAt(u){
    if(u<=0||u>=1)return 0;
    const scaled=u*4,i=Math.min(3,Math.max(0,Math.floor(scaled))),t=scaled-i,p=SETTINGS.speedPoints;
    return clamp(catmull1D(p[Math.max(0,i-1)],p[i],p[i+1],p[Math.min(4,i+2)],t),0,1.15);
  }
  function rebuildSpeedIntegral(){
    let area=0,previous=speedValueAt(0);speedIntegral[0]=0;
    for(let i=1;i<speedIntegral.length;i++){
      const u=i/(speedIntegral.length-1),value=speedValueAt(u);
      area+=(previous+value)/2/(speedIntegral.length-1);speedIntegral[i]=area;previous=value;
    }
    if(area<1e-6){for(let i=0;i<speedIntegral.length;i++)speedIntegral[i]=i/(speedIntegral.length-1);return;}
    for(let i=1;i<speedIntegral.length;i++)speedIntegral[i]/=area;
  }
  function speedAreaAt(u){
    const x=clamp(u,0,1)*(speedIntegral.length-1),i=Math.floor(x),q=x-i,a=speedIntegral[i],b=speedIntegral[Math.min(i+1,speedIntegral.length-1)];
    return a+(b-a)*q;
  }
  function profile(x){
    x=clamp(x,0,1);let i=0;while(i<nodes.length-2&&x>nodes[i+1].x)i++;
    const a=nodes[Math.max(0,i-1)],b=nodes[i],c=nodes[i+1],d=nodes[Math.min(nodes.length-1,i+2)],t=(x-b.x)/(c.x-b.x),t2=t*t,t3=t2*t;
    return .5*((2*b.y)+(-a.y+c.y)*t+(2*a.y-5*b.y+4*c.y-d.y)*t2+(-a.y+3*b.y-3*c.y+d.y)*t3);
  }
  for(let i=0;i<profileLookup.length;i++)profileLookup[i]=profile(i/(profileLookup.length-1));
  function ensureFieldAmpLookup(){
    if(fieldAmpLookupReady)return;
    for(let i=0;i<fieldAmpLookup.length;i++){
      const value=i/(fieldAmpLookup.length-1)*2.4;
      const normalized=value>1e-8?Math.sqrt(Math.max(0,-Math.log(value))/logThreshold):1;
      fieldAmpLookup[i]=profileLookup[Math.round(clamp(normalized,0,1)*(profileLookup.length-1))];
    }
    fieldAmpLookupReady=true;
  }
  function curve(u){return{x:halfSpan()/sigma*u*u,y:4.8*(2*u-u*u)};}
  function connected(u){
    const p=curve(u),extent=Math.ceil(halfSpan()/sigma+3),step=.12,nx=Math.ceil(2*extent/step)+1,ny=85;
    const weight=bridgeWeight(p.x*sigma),ratio=movingSigma(p.x*sigma)/sigma,movingDen=2*ratio*ratio;
    const grid=new Uint8Array(nx*ny),queue=new Int32Array(nx*ny);
    for(let row=0;row<ny;row++){
      const y=row*step-2,centerY=Math.exp(-y*y/2),movingY=Math.exp(-((y-p.y)**2)/movingDen);
      for(let col=0;col<nx;col++){
        const x=col*step-extent,nearest=clamp(x,-p.x,p.x);
        const pair=(Math.exp(-((x-p.x)**2)/movingDen)+Math.exp(-((x+p.x)**2)/movingDen))*movingY;
        const capsule=2*Math.exp(-((x-nearest)**2)/movingDen)*movingY;
        grid[row*nx+col]=Math.exp(-x*x/2)*centerY+(1-weight)*pair+weight*capsule>=threshold?1:0;
      }
    }
    const index=(x,y)=>Math.round((y+2)/step)*nx+Math.round((x+extent)/step),from=index(0,0),target=index(p.x,p.y);
    let head=0,tail=1;queue[0]=from;grid[from]=2;
    while(head<tail){
      const current=queue[head++];if(current===target)return true;const col=current%nx;
      for(const next of [col>0?current-1:-1,col<nx-1?current+1:-1,current-nx,current+nx]){
        if(next>=0&&next<grid.length&&grid[next]===1){grid[next]=2;queue[tail++]=next;}
      }
    }
    return false;
  }
  function calibrate(){
    let low=0,high=1;
    for(let i=0;i<17;i++){const mid=(low+high)/2;if(connected(mid))low=mid;else high=mid;}
    splitU=(low+high)/2;
  }
  function buildPath(){
    calibrate();path=[{s:0,x:0,y:0,u:0}];
    for(let i=1;i<=600;i++){
      const u=i/600,p=curve(u),previous=path[path.length-1],x=p.x*sigma,y=p.y*sigma;
      path.push({s:previous.s+Math.hypot(x-previous.x,y-previous.y),x,y,u});
    }
  }
  function arcAt(u){
    const f=u*600,i=Math.floor(f),a=path[i],b=path[Math.min(i+1,600)];
    return a.s+(b.s-a.s)*(f-i);
  }
  function readTiming(){
    const t1=SETTINGS.pauseSec,t2=SETTINGS.revealSec,s1=arcAt(splitU),end=path[path.length-1].s;
    const begin=Math.max(0,t1-1.4*s1/SETTINGS.speed),h0=Math.max(.001,t1-begin),h1=Math.max(.001,t2-t1);
    const times=[begin,t1,t2],dist=[0,s1,end],d0=s1/h0,d1=(end-s1)/h1,w1=2*h1+h0,w2=h1+2*h0;
    const slopes=[0,(w1+w2)/(w1/d0+w2/d1),0];
    timing={t2,times,dist,slopes,motionMs:t2*1000,handoffMs:SETTINGS.handoffSec*1000,total:t2*1000+SETTINGS.handoffSec*1000};
  }
  function distanceAt(t){
    const {times,dist,slopes}=timing;
    if(t<=times[0])return 0;if(t>=times[2])return dist[2];
    let i=0;while(i<1&&t>times[i+1])i++;
    const h=times[i+1]-times[i],u=(t-times[i])/h,u2=u*u,u3=u2*u;
    return (2*u3-3*u2+1)*dist[i]+(u3-2*u2+u)*h*slopes[i]+(-2*u3+3*u2)*dist[i+1]+(u3-u2)*h*slopes[i+1];
  }
  function motionSecondsAt(ms){
    const normalized=clamp(ms/Math.max(1,timing.motionMs),0,1);
    return speedAreaAt(normalized)*timing.t2;
  }
  function applyMaterial(){
    if(saturationNode)saturationNode.setAttribute('values',SETTINGS.saturation.toFixed(2));
    if(backdropLayer){
      const filter='blur('+SETTINGS.blurPx.toFixed(1)+'px) saturate('+SETTINGS.saturation.toFixed(2)+')';
      backdropLayer.style.backdropFilter=filter;backdropLayer.style.webkitBackdropFilter=filter;
    }
    if(materialSurface){
      const alpha=(SETTINGS.frost*.01+SETTINGS.frost*.99*.22).toFixed(3);
      materialSurface.setAttribute('fill-opacity',alpha);materialSurface.setAttribute('fill','rgb(185,208,239)');
    }
  }
  function syncStartupIcons(){
    if(!iconsFo||!width)return;
    const runtimeWidth=width/1.1;
    iconsFo.setAttribute('x',String((width-runtimeWidth)/2));iconsFo.setAttribute('y',String(baseY-32));
    iconsFo.setAttribute('width',String(runtimeWidth));iconsFo.setAttribute('height','64');
  }
  function setInitialState(){
    handoffProgress=0;scene.style.visibility='visible';scene.style.opacity='1';
    iconLayer.style.opacity='0';iconLayer.style.willChange='opacity';iconLayer.inert=true;iconLayer.setAttribute('startup','');
    iconMask.classList.remove('tabs-interactive');iconMask.style.pointerEvents='none';
  }
  function setFinalState(){
    const changed=!iconMask.classList.contains('tabs-interactive');
    handoffProgress=1;scene.style.opacity='0';scene.style.visibility='hidden';
    iconLayer.style.opacity='1';iconLayer.style.willChange='auto';iconLayer.inert=false;iconLayer.removeAttribute('startup');
    iconMask.classList.add('tabs-interactive');iconMask.style.pointerEvents='auto';
    if(changed)iconLayer.dispatchEvent(new Event('tabs-layout-ready'));
  }
  function setHandoffVisuals(progress){
    const p=clamp(progress,0,1);handoffProgress=p;scene.style.visibility='visible';scene.style.opacity=String(1-p);iconLayer.style.opacity=String(p);
    if(p<1){iconLayer.inert=true;iconMask.style.pointerEvents='none';return;}setFinalState();
  }
  function prepareGeometry(){
    const nextWidth=Math.round(root.host.clientWidth);if(!nextWidth)return false;
    width=nextWidth;applyLensSize();buildPath();readTiming();rebuildSpeedIntegral();ensureFieldAmpLookup();
    const liquidRadius=sigma*Math.sqrt(-2*Math.log(threshold));
    height=Math.max(64,Math.ceil(liquidRadius*2+12));baseY=height/2;
    root.host.style.setProperty('--runtime-tabs-width',width/1.1+'px');root.host.style.setProperty('--startup-scene-height',height+'px');
    scene.style.bottom=(32-baseY)+'px';scene.setAttribute('viewBox','0 0 '+width+' '+height);scene.setAttribute('width',String(width));scene.setAttribute('height',String(height));
    if(refraction){
      refraction.setAttribute('filterUnits','userSpaceOnUse');refraction.setAttribute('x','0');refraction.setAttribute('y','0');refraction.setAttribute('width',String(width));refraction.setAttribute('height',String(height));
    }
    for(const element of [vector,vectorNoBlur,maskSurface]){if(!element)continue;element.setAttribute('width',String(width));element.setAttribute('height',String(height));}
    if(materialSurface){materialSurface.setAttribute('width',String(width));materialSurface.setAttribute('height',String(height));}
    const resolution=Math.max(2.2,Math.sqrt(width*height/55000));mapCanvas.width=Math.ceil(width/resolution);mapCanvas.height=Math.ceil(height/resolution);
    const runtimeWidth=width/1.1;iconMask.style.width=runtimeWidth+'px';iconMask.style.height='64px';iconLayer.style.width=runtimeWidth+'px';
    applyMaterial();syncStartupIcons();return true;
  }
  function pose(ms){
    const motionEnd=timing.motionMs,handoffElapsed=Math.max(0,ms-motionEnd),handoffP=timing.handoffMs>0?clamp(handoffElapsed/timing.handoffMs,0,1):1;
    const t=motionSecondsAt(Math.min(ms,motionEnd)),traveled=distanceAt(t),endDistance=Math.max(1e-6,path[path.length-1].s),progress=clamp(traveled/endDistance,0,1),x=halfSpan()*progress,baseX=width/2;
    bx=baseX-x;cx=baseX+x;by=cy=baseY;setHandoffVisuals(ms>=motionEnd?handoffP:0);syncStartupIcons();
  }
  function render(){
    if(!width||!mapCtx)return;
    const handoffEase=handoffProgress*handoffProgress*(3-2*handoffProgress),distortionStrength=1-Math.pow(clamp(handoffEase/.78,0,1),1.15);
    const mw=mapCanvas.width,mh=mapCanvas.height,sx=width/mw,sy=height/mh,map=mapCtx.createImageData(mw,mh),pixels=map.data;
    const offset=Math.abs(cx-width/2),movingS=movingSigma(offset),movingDen=2*movingS*movingS,invMovingS2=1/(movingS*movingS),weight=bridgeWeight(offset);
    const gainU=clamp(offset/Math.max(1,sigma*2.2),0,1),gainEase=gainU*gainU*(3-2*gainU),flowGain=.5+.5*gainEase;
    const xBody=new Float32Array(mw),xGrad=new Float32Array(mw);
    for(let x=0;x<mw;x++){
      const px=(x+.5)*sx,dxB=px-bx,dxC=px-cx,nearest=clamp(px,bx,cx),dxN=px-nearest;
      const eB=Math.exp(-(dxB*dxB)/movingDen),eC=Math.exp(-(dxC*dxC)/movingDen),eN=2*Math.exp(-(dxN*dxN)/movingDen);
      xBody[x]=flowGain*((1-weight)*(eB+eC)+weight*eN);
      xGrad[x]=-flowGain*((1-weight)*(dxB*eB+dxC*eC)+weight*dxN*eN)*invMovingS2;
    }
    for(let y=0;y<mh;y++){
      const py=(y+.5)*sy,dy=py-by,yGaussian=Math.exp(-(dy*dy)/movingDen),gyScale=-dy*invMovingS2;
      for(let x=0;x<mw;x++){
        const index=(y*mw+x)*4,field=xBody[x]*yGaussian;
        pixels[index]=128;pixels[index+1]=128;pixels[index+2]=0;pixels[index+3]=255;
        if(field<threshold-.025)continue;
        const gx=xGrad[x]*yGaussian,gy=gyScale*field,gradient=Math.sqrt(gx*gx+gy*gy),safe=Math.sqrt(gradient*gradient+.00000625);
        const lutIndex=Math.min(fieldAmpLookup.length-1,Math.max(0,Math.round(clamp(field/2.4,0,1)*(fieldAmpLookup.length-1))));
        const amp=fieldAmpLookup[lutIndex],distance=(field-threshold)/Math.max(gradient,.003),edgeT=clamp((distance-1.7)/3,0,1),edgeGate=edgeT*edgeT*(3-2*edgeT);
        const dx=gx/safe*amp*12*distortionStrength*edgeGate,dyDisplacement=gy/safe*amp*17.5*distortionStrength*edgeGate;
        pixels[index]=Math.round(clamp(128+dx/64*255,0,255));pixels[index+1]=Math.round(clamp(128+dyDisplacement/64*255,0,255));pixels[index+2]=Math.round(clamp(distance/sx+.5,0,1)*255);
      }
    }
    mapCtx.putImageData(map,0,0);const mapUrl=mapCanvas.toDataURL('image/png');
    vector?.setAttribute('href',mapUrl);vectorNoBlur?.setAttribute('href',mapUrl);maskSurface?.setAttribute('href',mapUrl);
    if((bezelFrame++&1)===0||handoffProgress>=1)renderBezel(movingS,weight,flowGain);
  }
  function renderBezel(movingS,weight,flowGain){
    if(!bezelCtx||!bezelSurface)return;
    const scale=1.25,supportLevel=Math.max(.001,threshold-.06),supportRadius=movingS*Math.sqrt(-2*Math.log(supportLevel/3)),pad=Math.max(10,supportRadius+6);
    const x0=Math.max(0,Math.floor(bx-pad)),x1=Math.min(width,Math.ceil(cx+pad)),y0=Math.max(0,Math.floor(by-pad)),y1=Math.min(height,Math.ceil(by+pad));
    const bw=Math.max(1,x1-x0),bh=Math.max(1,y1-y0),cw=Math.max(1,Math.ceil(bw*scale)),ch=Math.max(1,Math.ceil(bh*scale));
    if(bezelCanvas.width!==cw)bezelCanvas.width=cw;if(bezelCanvas.height!==ch)bezelCanvas.height=ch;
    const image=bezelCtx.createImageData(cw,ch),p=image.data,movingDen=2*movingS*movingS,invS2=1/(movingS*movingS),sqrt2=Math.SQRT2;
    const bodyX=new Float32Array(cw),gradX=new Float32Array(cw);
    for(let x=0;x<cw;x++){
      const px=x0+(x+.5)/scale,dxB=px-bx,dxC=px-cx,nearest=clamp(px,bx,cx),dxN=px-nearest;
      const eB=Math.exp(-(dxB*dxB)/movingDen),eC=Math.exp(-(dxC*dxC)/movingDen),eN=2*Math.exp(-(dxN*dxN)/movingDen);
      bodyX[x]=flowGain*((1-weight)*(eB+eC)+weight*eN);gradX[x]=-flowGain*((1-weight)*(dxB*eB+dxC*eC)+weight*dxN*eN)*invS2;
    }
    for(let y=0;y<ch;y++){
      const py=y0+(y+.5)/scale,dy=py-by,yGaussian=Math.exp(-(dy*dy)/movingDen),gyScale=-dy*invS2;
      for(let x=0;x<cw;x++){
        const index=(y*cw+x)*4,field=bodyX[x]*yGaussian;if(field<threshold-.06)continue;
        const gx=gradX[x]*yGaussian,gy=gyScale*field,gradient=Math.sqrt(gx*gx+gy*gy),safe=Math.max(gradient,.003),distance=(field-threshold)/safe,coverage=clamp(distance*scale+.5,0,1);
        if(coverage<=0)continue;
        const nx=-gx/safe,ny=-gy/safe,edge=Math.exp(-(((distance-.30)/.48)**2)),soft=Math.exp(-(((distance-1.10)/1.05)**2));
        const topLeft=Math.pow(Math.max(0,(-nx-ny)/sqrt2),11),bottomRight=Math.pow(Math.max(0,(nx+ny)/sqrt2),11);
        const base=coverage*(.014+.055*edge),highlight=coverage*soft*(.46*topLeft+.36*bottomRight),alpha=clamp(base+highlight,0,.58),mix=clamp((topLeft+bottomRight)*.9,0,1);
        p[index]=Math.round(205+38*mix);p[index+1]=Math.round(214+34*mix);p[index+2]=Math.round(225+30*mix);p[index+3]=Math.round(alpha*255);
      }
    }
    bezelCtx.putImageData(image,0,0);bezelSurface.setAttribute('x',String(x0));bezelSurface.setAttribute('y',String(y0));bezelSurface.setAttribute('width',String(bw));bezelSurface.setAttribute('height',String(bh));bezelSurface.setAttribute('href',bezelCanvas.toDataURL('image/png'));
  }
  function settle(){
    if(!prepareGeometry())return;
    const x=halfSpan(),baseX=width/2;bx=baseX-x;cx=baseX+x;by=cy=baseY;syncStartupIcons();setFinalState();window.dispatchEvent(new Event('resize'));
  }
  function play(){
    if(!prepareGeometry())return;
    setInitialState();running=true;startTime=performance.now();
    function frame(now){
      const elapsed=Math.min(timing.total,now-startTime);pose(elapsed);render();
      if(elapsed<timing.total)requestAnimationFrame(frame);
      else{running=false;if(Math.round(root.host.clientWidth)!==width)settle();else{setFinalState();window.dispatchEvent(new Event('resize'));}}
    }
    frame(startTime);
  }
  listen(document,'pointerup',()=>{pointerId=null});
  listen(document,'pointercancel',()=>{pointerId=null});
  let lastWidth=0;
  const resize=new ResizeObserver(()=>{if(root.host.clientWidth===lastWidth)return;lastWidth=root.host.clientWidth;if(!running)settle();});
  resize.observe(root.host);
  if(playEntrance)play();else settle();
  return{
    setValue(index){selectIndex(index)},
    dispose(){
      disposed=true;
      timers.forEach(id=>globalThis.clearTimeout(id));frames.forEach(id=>globalThis.cancelAnimationFrame(id));
      observers.forEach(observer=>observer.disconnect());animations.forEach(animation=>animation.cancel());disposers.forEach(dispose=>dispose());
      if(pointerId!==null&&paneElement.hasPointerCapture?.(pointerId))paneElement.releasePointerCapture(pointerId);
    },
  };
}
