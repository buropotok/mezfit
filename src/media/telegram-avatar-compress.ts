/** Telegram JPEG compression runs only in the Mini App's JavaScript Canvas.
 * Neither Cloudflare Images nor a server-side image transcoder is involved.
 */
const LIMITS = {
  small: { side: 128, bytes: 50_000 },
  large: { side: 512, bytes: 245_000 },
} as const;

type Variant = keyof typeof LIMITS;
const ATTEMPTS = [
  { scale: 1, quality: 0.85 },
  { scale: 1, quality: 0.70 },
  { scale: 0.75, quality: 0.55 },
  { scale: 0.50, quality: 0.40 },
  { scale: 0.375, quality: 0.28 },
] as const;

function openImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const image = new Image();
    const done = () => URL.revokeObjectURL(url);
    image.onload = () => {
      done();
      resolve(image);
    };
    image.onerror = () => {
      done();
      reject(new Error('TELEGRAM_AVATAR_DECODE_FAILED'));
    };
    image.src = url;
  });
}

function encodeJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob?.type === 'image/jpeg'
        ? resolve(blob) : reject(new Error('TELEGRAM_AVATAR_ENCODE_FAILED')),
      'image/jpeg', quality,
    );
  });
}

async function compressVariant(image: HTMLImageElement, variant: Variant): Promise<Blob> {
  const longest = Math.max(image.naturalWidth, image.naturalHeight);
  if (!Number.isFinite(longest) || longest <= 0) {
    throw new Error('TELEGRAM_AVATAR_DECODE_FAILED');
  }
  const { side, bytes } = LIMITS[variant];
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('TELEGRAM_AVATAR_CANVAS_UNAVAILABLE');
  for (const { scale, quality } of ATTEMPTS) {
    const factor = Math.min(1, side / longest) * scale;
    canvas.width = Math.max(1, Math.round(image.naturalWidth * factor));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * factor));
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const candidate = await encodeJpeg(canvas, quality);
    if (candidate.size >= 16 && candidate.size <= bytes) return candidate;
  }
  throw new Error('TELEGRAM_AVATAR_TOO_LARGE');
}

export async function compressTelegramAvatar(source: Blob): Promise<{ small: Blob; large: Blob }> {
  if (source.type !== 'image/jpeg' || source.size < 16 || source.size > 20_000_000) {
    throw new Error('INVALID_TELEGRAM_AVATAR_SOURCE');
  }
  const image = await openImage(source);
  return {
    small: await compressVariant(image, 'small'),
    large: await compressVariant(image, 'large'),
  };
}
