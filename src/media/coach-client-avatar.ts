/** Convert a user-selected local image into the same bounded variants as contact avatars.
 * Browser Canvas is the only image processor: no network, Cloudflare or bot API.
 */
type Variant = 'small' | 'large';
const limits = {
  small: { side: 128, bytes: 50_000 },
  large: { side: 512, bytes: 245_000 },
} as const;

const qualities = [
  { scale: 1, quality: 0.84 },
  { scale: 1, quality: 0.68 },
  { scale: 0.75, quality: 0.55 },
  { scale: 0.5, quality: 0.42 },
  { scale: 0.375, quality: 0.3 },
] as const;

async function decodeLocalImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('AVATAR_FILE_UNREADABLE'));
      image.src = url;
    });
  } finally {
    // Image bytes remain decoded in memory even after the temporary URL is revoked.
    URL.revokeObjectURL(url);
  }
}

function canvasJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob?.type === 'image/jpeg'
        ? resolve(blob) : reject(new Error('AVATAR_JPEG_UNSUPPORTED')),
      'image/jpeg', quality,
    );
  });
}

async function renderVariant(image: HTMLImageElement, variant: Variant): Promise<Blob> {
  const maxSide = Math.max(image.naturalWidth, image.naturalHeight);
  if (!maxSide) throw new Error('AVATAR_FILE_UNREADABLE');
  const maxSize = limits[variant];
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('AVATAR_CANVAS_UNAVAILABLE');
  for (const attempt of qualities) {
    const ratio = Math.min(1, maxSize.side / maxSide) * attempt.scale;
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const jpeg = await canvasJpeg(canvas, attempt.quality);
    if (jpeg.size >= 16 && jpeg.size <= maxSize.bytes) return jpeg;
  }
  throw new Error('AVATAR_TOO_COMPLEX');
}

export async function prepareCoachClientAvatar(file: File): Promise<{ small: Blob; large: Blob }> {
  if (!file.type.startsWith('image/') || file.size === 0 || file.size > 20_000_000) {
    throw new Error('INVALID_AVATAR_FILE');
  }
  const image = await decodeLocalImage(file);
  return {
    small: await renderVariant(image, 'small'),
    large: await renderVariant(image, 'large'),
  };
}
