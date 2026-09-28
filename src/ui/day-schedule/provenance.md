# Day Schedule prototype core

`DaySchedule` adapts `mezfit_day_schedule_prototype_v26_synchronized_day_lens.html`
(2026-09-28). The lens optics, 300 ms travel and tuned spring are retained from
Sol's DaySchedule snapshot at `5df001b48a136c5a6d21e156a747422281105723`.

## Public boundary

The caller owns the controlled `date` (`YYYY-MM-DD`), `eventsByDate`, event-card
presentation through `renderEvent`, app actions and persistence. Accept date
requests by setting `date` in `onDateChange`; rejected requests return to the
caller's selection. A later external date update always wins and cancels pending
paging. A request is not a server mutation and should not await network I/O.

The component owns week/day paging, synchronization, timeline geometry and one
minute-aligned local wall clock. `today` optionally overrides the calendar date
for demos; clock minutes still use device local time. A product timezone adapter
belongs at the caller boundary before adding timezone-specific scheduling.

The displayed range is 06:00–24:00, 112 px/hour, with an initial 08:00 scroll,
matching v26. Events outside the displayed range are clipped; invalid/nonpositive
intervals are omitted. Event frames never extend beyond their time interval.
Cards must fit the supplied frame; compact content is the renderer's concern.
The caller supplies non-overlapping events. Business conflict detection,
move/resize, the event editor and backend/API integration are outside this slice.

## Gesture and animation ownership

- DaySchedule alone recognizes week touch gestures; the private optical runtime
  has no pointer/click handlers and cannot emit date changes.
- A week tap calls the typed optical command and requests one date change.
- Horizontal week dragging pages the entire seven-slot container.
- Horizontal day dragging pages the adjacent day; vertical touch remains scroll.
- Sunday/Monday crossings page day and week together over 300 ms.
- Incoming weeks are neutral. After the controlled date is committed, wait 50 ms,
  then invoke the ordinary lens travel -> spring -> selector command.
- One paging transition runs at a time. Repeated gestures during settling are
  ignored; external date changes interrupt and cancel old callbacks.
- Pointer moves update only this component's track transforms, not event content.
- Interactive descendants and `data-schedule-no-swipe` regions opt out of day
  paging, preserving event controls. A completed drag suppresses the trailing tap.
- Unmount cancels schedule timers, animation frames and optical resources.

WeekScene owns its ShadowRoot and typed optical controller. The optical CSS and
runtime are private to DaySchedule, not imports of another component's private
implementation. Konsta Navbar/Link retain their stock presentation; no private
Konsta selectors are overridden.

## Verification

Tests cover controlled-date interruption, repeated gestures, touch tap/click
suppression, long-press followed by swipe, cancellation, vertical scroll,
Sunday/Monday handoff, rejected requests, unmount, geometry and clock rollover.
JSDOM does not validate native pointer capture, compositing or visual fidelity.
Before merge, compare v26 on iOS WKWebView and Android WebView: swipe both
ways, interrupt with an external date selection, and inspect lens/spring handoff.
