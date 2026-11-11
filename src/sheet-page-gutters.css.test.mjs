import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function css(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

function rule(source, selector) {
  const start = source.indexOf(selector);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf('}', start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

const contentInsets = [
  ['./workout/planned-workouts.css', '.planned-workouts {', 'padding: var(--ui-space-4) var(--page-pad-x)'],
  ['./schedule/workout-planning.css', '.workout-planning-sheet {', 'padding: 16px var(--page-pad-x)'],
  ['./schedule/calendar-session-sheet.css', '.calendar-session-sheet__header {', 'padding: 16px var(--page-pad-x) 8px'],
  ['./schedule/calendar-session-sheet.css', '.calendar-session-sheet__body {', 'padding: 0 var(--page-pad-x) 24px'],
  ['./schedule/occurrence-draft-sheet.css', '.occurrence-draft-sheet__header, .occurrence-draft-sheet__footer {', 'padding: 16px var(--page-pad-x)'],
  ['./schedule/occurrence-draft-sheet.css', '.occurrence-draft-sheet__body {', 'padding: 0 var(--page-pad-x) 24px'],
  ['./schedule/personal-event-sheet.css', '.personal-event-sheet__header,\n.personal-event-sheet__footer {', 'padding: 16px var(--page-pad-x)'],
  ['./schedule/personal-event-sheet.css', '.personal-event-sheet__body {', 'padding: 0 var(--page-pad-x) 24px'],
  ['./workout/workout-completion-sheet.css', '.workout-completion-sheet {', 'padding: 20px var(--page-pad-x)'],
  ['./workout/workout-exercise-selection.css', '.workout-exercise-selection__header {', 'padding: var(--space-3) var(--page-pad-x)'],
  ['./workout/workout-exercise-selection.css', '.workout-exercise-selection__catalog {', 'padding: 0 var(--page-pad-x) var(--space-3)'],
  ['./workout/workout-exercise-selection.css', '.workout-exercise-selection__footer {', 'padding: var(--space-3) var(--page-pad-x)'],
  ['./workout/set-entry-weight-reps.css', '.set-entry-weight-reps__body {', 'padding: 10px var(--page-pad-x) 24px'],
  ['./workout/set-entry-weight-reps.css', '.set-entry-weight-reps__header {', 'padding: 12px var(--page-pad-x) 8px calc(var(--page-pad-x) + 4px)'],
  ['./program/cloud-plan-management.css', '.cloud-plan-client-picker {', 'padding: var(--ui-space-4, 16px) var(--page-pad-x)'],
  ['./program/cloud-plan-management.css', '.program-exercise-information {', 'padding: var(--ui-space-4) var(--page-pad-x)'],
  ['./schedule/schedule-client-filter.css', '.schedule-client-filter {', 'padding: 16px var(--page-pad-x)'],
  ['./discussions/entity-discussions.css', '.entity-discussions{', 'padding:16px var(--page-pad-x)'],
];

describe('Bottom Sheet page gutters', () => {
  it('shares the 8px page inset without adding padding to the Konsta adapter', () => {
    expect(css('./style.css')).toContain('--page-pad-x: 8px;');
    const adapter = rule(css('./ui/konsta-mezfit/bottom-sheet.css'), '.ui-mezfit-bottom-sheet__content {');
    expect(adapter).not.toContain('padding-inline');
    expect(adapter).not.toContain('padding-left');
    expect(adapter).not.toContain('padding-right');
  });

  it.each(contentInsets)('%s: %s uses the common page inset', (path, selector, expected) => {
    expect(rule(css(path), selector)).toContain(expected);
  });

  it('preserves the inner card padding and the Konsta field-list alignment', () => {
    const occurrence = css('./schedule/occurrence-draft-sheet.css');
    expect(rule(occurrence, '.occurrence-draft-sheet--inline .occurrence-draft-sheet__body {'))
      .toContain('padding-inline: 16px');
    expect(rule(occurrence, '.occurrence-draft-sheet__timing {'))
      .toContain('margin-inline-start: max(-10px, calc(var(--page-pad-x) * -1))');
    expect(rule(occurrence, '.occurrence-draft-sheet--inline .occurrence-draft-sheet__timing {'))
      .toContain('margin-inline-start: -10px');
    const personalEvent = css('./schedule/personal-event-sheet.css');
    expect(rule(personalEvent, '.personal-event-sheet__timing {'))
      .toContain('margin-inline-start: max(-10px, calc(var(--page-pad-x) * -1))');
    expect(rule(personalEvent, '.personal-event-sheet__field-list {'))
      .toContain('margin-inline: -16px');
  });
});
