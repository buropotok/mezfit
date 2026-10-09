export type LiquidPopoverRenderMode = 'auto' | 'svg' | 'canvas';
export type ResolvedLiquidPopoverRenderMode = Exclude<LiquidPopoverRenderMode, 'auto'>;

export interface LiquidPopoverPlatformInfo {
  userAgent: string;
  maxTouchPoints?: number;
  telegramPlatform?: string;
}

function getPlatformInfo(): LiquidPopoverPlatformInfo | null {
  if (typeof navigator === 'undefined') return null;
  return {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    telegramPlatform: typeof window === 'undefined'
      ? undefined
      : window.Telegram?.WebApp?.platform,
  };
}

/** Platform-specific Canvas clipping avoids WebKit SVG clip-path compositing. */
export function resolveLiquidPopoverRenderMode(
  mode: LiquidPopoverRenderMode,
  platform: LiquidPopoverPlatformInfo | null = getPlatformInfo(),
): ResolvedLiquidPopoverRenderMode {
  if (mode !== 'auto') return mode;
  if (!platform) return 'svg';
  if (platform.telegramPlatform === 'ios') return 'canvas';
  if (/iPhone|iPad|iPod/i.test(platform.userAgent)) return 'canvas';
  if (/Macintosh/i.test(platform.userAgent) && (platform.maxTouchPoints ?? 0) > 1)
    return 'canvas';
  return 'svg';
}
