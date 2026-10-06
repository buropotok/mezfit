import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const themeCss = readFileSync(new URL('./theme.css', import.meta.url), 'utf8');
const dayScheduleCss = readFileSync(new URL('./ui/day-schedule.css', import.meta.url), 'utf8');
const dayScheduleCatalog = readFileSync(new URL('./ui/DayScheduleCatalog.tsx', import.meta.url), 'utf8');

describe('app background CSS contract', () => {
  it('keeps every theme canvas black', () => {
    const backgrounds = [...themeCss.matchAll(/--theme-bg:\s*([^;]+);/g)]
      .map((match) => match[1]?.trim());

    expect(backgrounds.length).toBeGreaterThan(0);
    expect(backgrounds.every((background) => background === '#000000')).toBe(true);
  });

  it('uses the shared fitness artwork on the application canvas', () => {
    expect(themeCss).toContain("background-image: url('./assets/fitness-background.svg');");
    expect(themeCss).toContain('background-position: center top;');
    expect(themeCss).toContain('background-repeat: no-repeat;');
    expect(themeCss).toContain('background-size: cover;');
  });

  it('keeps the day schedule canvas black without a background image', () => {
    const rootRule = dayScheduleCss.match(/\.ui-day-schedule\s*\{([\s\S]*?)\}/)?.[1] ?? '';

    expect(rootRule).toContain('background: #000;');
    expect(rootRule).not.toContain('url(');
  });

  it('documents the DaySchedule canvas as solid black', () => {
    expect(dayScheduleCatalog).toContain('Фон календаря — чистый чёрный canvas.');
    expect(dayScheduleCatalog).not.toContain('Фон календаря использует фоновое изображение DaySchedule.');
  });
});
