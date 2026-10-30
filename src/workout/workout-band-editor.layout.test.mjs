import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./WorkoutBandControl.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./workout-band-control.css', import.meta.url), 'utf8');

function cssRule(selector) {
  const start = styles.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = styles.indexOf('}', start);
  expect(end).toBeGreaterThan(start);
  return styles.slice(start, end);
}

describe('workout band editor Save visibility', () => {
  it('renders the Save action before the color wheel, within the native RangePicker footer', () => {
    const footer = source.indexOf('footer={<div className="workout-band-editor">');
    const actions = source.indexOf('className="workout-band-editor__actions"', footer);
    const save = source.indexOf('<KonstaButton rounded', actions);
    const controls = source.indexOf('className="workout-band-editor__controls"', save);
    const wheel = source.indexOf('<GlassBackgroundColorControls', controls);
    expect(footer).toBeGreaterThanOrEqual(0);
    expect(actions).toBeGreaterThan(footer);
    expect(save).toBeGreaterThan(actions);
    expect(controls).toBeGreaterThan(save);
    expect(wheel).toBeGreaterThan(controls);
  });

  it('keeps Save outside the only scrollable section in the editor', () => {
    const editor = cssRule('.workout-band-editor');
    const actions = cssRule('.workout-band-editor__actions');
    const controls = cssRule('.workout-band-editor__controls');
    expect(editor).toContain('max-height:');
    expect(editor).not.toContain('overflow-y: auto');
    expect(actions).toContain('flex: 0 0 auto');
    expect(actions).not.toContain('overflow-y: auto');
    expect(controls).toContain('min-height: 0');
    expect(controls).toContain('overflow-y: auto');
  });
});
