/** Decode Telegram media once, then independently encode two bounded JPEG variants.
 * Images binding transforms bytes in memory and does not persist them to Images/R2.
 */
export type ContactAvatarVariant = 'small' | 'large';

export const AVATAR_LIMITS = {
  small: { width: 128, bytes: 50_000 },
  large: { width: 512, bytes: 245_000 },
} as const;

const attempts: Record<ContactAvatarVariant, readonly { width: number; quality: number }[]> = {
  small: [
    { width: 128, quality: 80 },
    { width: 128, quality: 65 },
    { width: 96, quality: 52 },
    { width: 64, quality: 38 },
    { width: 48, quality: 25 },
  ],
  large: [
    { width: 512, quality: 85 },
    { width: 512, quality: 70 },
    { width: 384, quality: 60 },
    { width: 256, quality: 48 },
    { width: 128, quality: 32 },
  ],
};

function jpeg(bytes: ArrayBuffer): boolean {
  const view = new Uint8Array(bytes);
  return view.length >= 16 && view[0] === 0xff && view[1] === 0xd8 && view[2] === 0xff;
}

/** No value over the requested limit is ever returned to the Dexie blob uploader. */
export async function optimizeContactAvatar(
  images: Pick<ImagesBinding, 'input'>,
  source: ArrayBuffer,
  variant: ContactAvatarVariant,
): Promise<ArrayBuffer | null> {
  if (!jpeg(source)) return null;
  for (const { width, quality } of attempts[variant]) {
    const result = await images.input(new Blob([source]).stream())
      .transform({ width, height: width, fit: 'scale-down' })
      .output({ format: 'image/jpeg', quality, anim: false });
    const response = result.response();
    if (!response.ok) throw new Error('AVATAR_TRANSFORM_FAILED');
    const size = Number(response.headers.get('content-length'));
    if (Number.isFinite(size) && size > AVATAR_LIMITS[variant].bytes) continue;
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength <= AVATAR_LIMITS[variant].bytes && jpeg(bytes)) return bytes;
  }
  return null;
}
