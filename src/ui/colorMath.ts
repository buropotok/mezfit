/** HSV representation used by the UI Kit color wheel (degrees, percentages). */
export type HsvColor = {
  hue: number;
  saturation: number;
  value: number;
};

function toHexChannel(value: number) {
  return Math.round(value).toString(16).padStart(2, '0');
}

export function hsvToHex({ hue, saturation, value }: HsvColor) {
  const normalizedHue = ((hue % 360) + 360) % 360;
  const s = Math.max(0, Math.min(100, saturation)) / 100;
  const v = Math.max(0, Math.min(100, value)) / 100;
  const chroma = v * s;
  const hueSector = normalizedHue / 60;
  const x = chroma * (1 - Math.abs((hueSector % 2) - 1));
  const offset = v - chroma;

  let r = 0;
  let g = 0;
  let b = 0;

  if (hueSector < 1) [r, g, b] = [chroma, x, 0];
  else if (hueSector < 2) [r, g, b] = [x, chroma, 0];
  else if (hueSector < 3) [r, g, b] = [0, x, chroma];
  else if (hueSector < 4) [r, g, b] = [0, chroma, x];
  else if (hueSector < 5) [r, g, b] = [x, 0, chroma];
  else [r, g, b] = [chroma, 0, x];

  return `#${toHexChannel((r + offset) * 255)}${toHexChannel((g + offset) * 255)}${toHexChannel((b + offset) * 255)}`.toUpperCase();
}
