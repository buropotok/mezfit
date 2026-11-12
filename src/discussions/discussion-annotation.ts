export interface AnnotationPoint { x: number; y: number }
export type AnnotationLine = readonly AnnotationPoint[];
export interface AnnotationDrawing {
  completed: readonly AnnotationLine[];
  active: AnnotationLine | null;
}

interface AnnotationHistory {
  past: readonly AnnotationDrawing[];
  current: AnnotationDrawing;
  future: readonly AnnotationDrawing[];
}

export type AnnotationAction =
  | { type: 'start' | 'finish' | 'undo' | 'redo' }
  | { type: 'add'; point: AnnotationPoint }
  | { type: 'remove'; index: number }
  | { type: 'move'; index: number; point: AnnotationPoint };

const center = { x: 0.5, y: 0.5 };

export const initialAnnotationHistory: AnnotationHistory = {
  past: [{ completed: [], active: null }],
  current: { completed: [], active: [center] },
  future: [],
};

export function editAnnotation(history: AnnotationHistory, action: AnnotationAction): AnnotationHistory {
  const { past, current, future } = history;
  const { active, completed } = current;
  let next: AnnotationDrawing;
  switch (action.type) {
    case 'undo': {
      const previous = past.at(-1);
      return previous ? { past: past.slice(0, -1), current: previous, future: [current, ...future] } : history;
    }
    case 'redo': {
      const [following, ...rest] = future;
      return following ? { past: [...past, current], current: following, future: rest } : history;
    }
    case 'start':
      if (active) return history;
      next = { completed, active: [center] };
      break;
    case 'finish':
      if (!active) return history;
      next = { completed: active.length > 1 ? [...completed, active] : completed, active: null };
      break;
    case 'add':
      if (!active) return history;
      next = { completed, active: [...active, action.point] };
      break;
    case 'remove':
      if (!active?.[action.index]) return history;
      next = { completed, active: active.filter((_, index) => index !== action.index) };
      break;
    case 'move': {
      const original = active?.[action.index];
      if (!active || !original || (original.x === action.point.x && original.y === action.point.y)) return history;
      next = { completed, active: moveAnnotationPoint(active, action.index, action.point) };
      break;
    }
  }
  return { past: [...past, current], current: next, future: [] };
}

export function moveAnnotationPoint(line: AnnotationLine, index: number, point: AnnotationPoint): AnnotationLine {
  return line.map((previous, position) => position === index ? point : previous);
}

interface ImageRect { x: number; y: number; width: number; height: number }

export function containAnnotationImage(width: number, height: number, image: Pick<HTMLCanvasElement, 'width' | 'height'>): ImageRect {
  const scale = Math.min(width / image.width, height / image.height);
  const imageWidth = image.width * scale;
  const imageHeight = image.height * scale;
  return { x: (width - imageWidth) / 2, y: (height - imageHeight) / 2, width: imageWidth, height: imageHeight };
}

export function drawAnnotation(context: CanvasRenderingContext2D, image: HTMLCanvasElement, rect: ImageRect,
  lines: readonly AnnotationLine[]) {
  const { x, y, width, height } = rect;
  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();
  context.drawImage(image, x, y, width, height);
  context.strokeStyle = '#ffdc42';
  context.lineWidth = Math.min(width, height) * 0.006;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const line of lines) {
    if (line.length < 2) continue;
    context.beginPath();
    line.forEach((point, index) => {
      const left = x + point.x * width;
      const top = y + point.y * height;
      if (index === 0) context.moveTo(left, top);
      else context.lineTo(left, top);
    });
    context.stroke();
  }
  context.restore();
}

export function copyAnnotationImage(source: HTMLImageElement | HTMLVideoElement): HTMLCanvasElement {
  const width = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
  const height = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
  if (!width || !height) throw new Error('ANNOTATION_IMAGE_NOT_READY');
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 4096 / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('ANNOTATION_CANVAS_UNAVAILABLE');
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  // Check whether the original permits canvas access while still in the viewer.
  context.getImageData(0, 0, 1, 1);
  return canvas;
}

export async function exportAnnotation(image: HTMLCanvasElement, lines: readonly AnnotationLine[]): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('ANNOTATION_CANVAS_UNAVAILABLE');
  context.fillStyle = '#000';
  context.fillRect(0, 0, canvas.width, canvas.height);
  drawAnnotation(context, image, { x: 0, y: 0, width: canvas.width, height: canvas.height }, lines);
  try {
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      result => result ? resolve(result) : reject(new Error('ANNOTATION_EXPORT_FAILED')), 'image/jpeg', 0.92,
    ));
    return new File([blob], 'Фото с разметкой.jpg', { type: blob.type });
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
