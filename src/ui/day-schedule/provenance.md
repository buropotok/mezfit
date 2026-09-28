# Day Schedule prototype core

`DaySchedule` is the React/UI-Kit adapter for the approved one-day schedule prototype tuned on 2026-09-28.

## Public boundary

React owns:

- controlled local date (`YYYY-MM-DD`);
- event data grouped by local date;
- event rendering;
- app actions (back, open DatePicker, add event);
- persistence/API ownership outside the component.

The component owns:

- week navigation and the approved Liquid Glass day selector;
- whole-week horizontal paging;
- whole-day horizontal paging;
- synchronization between day paging and the week selector;
- title formatting (`Сегодня` or `Чт, 1 октября`);
- one-day timeline geometry;
- current-time marker;
- event frame `top` / `height` geometry.

The event card itself is deliberately not owned by `DaySchedule`. `renderEvent` receives the typed event and a compact-layout hint. Drag/resize mechanics will be added at the schedule/event-frame boundary when the dedicated `ScheduleEventCard` is introduced.

## Prototype interaction invariants

- Seven week slots always share the full visible Liquid Glass container width.
- The Liquid Glass optics reuse the approved Text Only private runtime; the schedule does not fork or restyle Konsta primitives.
- Swiping the schedule changes one day; selector travel starts in the same 300 ms interval.
- Swiping the week moves the whole week container.
- Crossing Sunday/Monday with a day swipe also pages the whole week container.
- After a week page finishes, the new week is shown first, then after 50 ms a normal Text Only tap drives lens -> spring -> selector.
- Event screens for previous/current/next day are present synchronously so the incoming day is visible during the swipe.
- Event frames do not overlap by design; overlap handling is not part of this component version.
