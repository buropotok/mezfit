import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { getTelegramWebApp } from '../telegram';
import { Button, GlassSurface, Text } from '../ui';
import { SCREEN_DIAGNOSTICS_DEEP_LINK } from './screenDiagnosticsRoute';
import './screen-diagnostics.css';

type MeasuredElement = {
  width: number;
  height: number;
};

type ScreenMeasurements = {
  innerWidth: number;
  innerHeight: number;
  clientWidth: number;
  screenWidth: number;
  screenHeight: number;
  devicePixelRatio: number;
  visualWidth: number | null;
  visualHeight: number | null;
  visualScale: number | null;
  rootFontSize: string;
  headlineFontSize: string;
  headlineLineHeight: string;
  textSizeAdjust: string;
  reference44: MeasuredElement | null;
  reference88: MeasuredElement | null;
  telegramPlatform: string;
  telegramVersion: string;
};

function measureElement(element: HTMLElement | null): MeasuredElement | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return { width: rect.width, height: rect.height };
}

function readScreenMeasurements(
  headline: HTMLElement | null,
  reference44: HTMLElement | null,
  reference88: HTMLElement | null,
): ScreenMeasurements {
  const rootStyle = getComputedStyle(document.documentElement);
  const headlineStyle = headline ? getComputedStyle(headline) : null;
  const viewport = window.visualViewport;
  const telegram = getTelegramWebApp();

  return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    clientWidth: document.documentElement.clientWidth,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    devicePixelRatio: window.devicePixelRatio,
    visualWidth: viewport?.width ?? null,
    visualHeight: viewport?.height ?? null,
    visualScale: viewport?.scale ?? null,
    rootFontSize: rootStyle.fontSize,
    headlineFontSize: headlineStyle?.fontSize ?? 'недоступно',
    headlineLineHeight: headlineStyle?.lineHeight ?? 'недоступно',
    textSizeAdjust: rootStyle.getPropertyValue('text-size-adjust').trim()
      || rootStyle.getPropertyValue('-webkit-text-size-adjust').trim()
      || 'не определено',
    reference44: measureElement(reference44),
    reference88: measureElement(reference88),
    telegramPlatform: telegram?.platform ?? 'неизвестно',
    telegramVersion: telegram?.version ?? 'неизвестно',
  };
}

function formatNumber(value: number | null, suffix = ''): string {
  return value === null || !Number.isFinite(value)
    ? 'недоступно'
    : `${Math.round(value * 100) / 100}${suffix}`;
}

function formatMeasuredElement(value: MeasuredElement | null): string {
  return value
    ? `${formatNumber(value.width)} × ${formatNumber(value.height)} px`
    : 'недоступно';
}

export function ScreenDiagnostics({ glassBlur }: { glassBlur: number }) {
  const headlineRef = useRef<HTMLDivElement>(null);
  const reference44Ref = useRef<HTMLDivElement>(null);
  const reference88Ref = useRef<HTMLDivElement>(null);
  const [measurements, setMeasurements] = useState<ScreenMeasurements | null>(null);
  const [copyStatus, setCopyStatus] = useState('');

  const refresh = useCallback(() => {
    setMeasurements(readScreenMeasurements(
      headlineRef.current?.firstElementChild as HTMLElement | null,
      reference44Ref.current,
      reference88Ref.current,
    ));
  }, []);

  useLayoutEffect(() => {
    refresh();
    window.addEventListener('resize', refresh);
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', refresh);
    return () => {
      window.removeEventListener('resize', refresh);
      viewport?.removeEventListener('resize', refresh);
    };
  }, [refresh]);

  const copyText = async (value: string, successMessage: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(value);
      setCopyStatus(successMessage);
    } catch {
      setCopyStatus('Копирование недоступно. Сделайте скриншот или выделите ссылку ниже.');
    }
  };

  const rows = measurements ? [
    ['Ширина окна', formatNumber(measurements.innerWidth, ' px')],
    ['Высота окна', formatNumber(measurements.innerHeight, ' px')],
    ['Ширина документа', formatNumber(measurements.clientWidth, ' px')],
    ['Размер экрана (CSS)', `${formatNumber(measurements.screenWidth)} × ${formatNumber(measurements.screenHeight)} px`],
    ['devicePixelRatio', formatNumber(measurements.devicePixelRatio)],
    ['VisualViewport: ширина', formatNumber(measurements.visualWidth, ' px')],
    ['VisualViewport: высота', formatNumber(measurements.visualHeight, ' px')],
    ['VisualViewport: масштаб', formatNumber(measurements.visualScale)],
    ['Размер html', measurements.rootFontSize],
    ['Текст Headline', measurements.headlineFontSize],
    ['Строка Headline', measurements.headlineLineHeight],
    ['Автомасштаб текста', measurements.textSizeAdjust],
    ['Эталон 44 × 44', formatMeasuredElement(measurements.reference44)],
    ['Эталон 88 × 44', formatMeasuredElement(measurements.reference88)],
    ['Telegram: платформа', measurements.telegramPlatform],
    ['Telegram: версия', measurements.telegramVersion],
  ] : [];

  return (
    <section className="settings-page" aria-label="Диагностика экрана">
      <GlassSurface
        component="section"
        wrapContent={false}
        preset="modalTuned"
        optics={false}
        blur={glassBlur}
        shape={{ radius: 16 }}
        className="settings-page__section"
      >
        <Text variant="title">Диагностика экрана</Text>
        <Text variant="footnote" tone="muted">
          Значения измеряются на этом устройстве. Откройте ту же страницу на втором телефоне
          и сравните ширину окна, масштаб и размеры контрольных элементов.
        </Text>

        <div className="screen-diagnostics__samples" aria-label="Контрольные размеры">
          <div ref={reference44Ref} className="screen-diagnostics__reference--44" aria-hidden="true" />
          <div ref={reference88Ref} className="screen-diagnostics__reference--88" aria-hidden="true" />
          <div ref={headlineRef}><Text variant="headline">Образец Headline</Text></div>
        </div>

        <div className="screen-diagnostics__measurements">
          {rows.map(([label, value]) => (
            <div className="screen-diagnostics__row" key={label}>
              <Text variant="footnote" tone="muted">{label}</Text>
              <Text variant="body">{value}</Text>
            </div>
          ))}
        </div>

        <Text variant="footnote" tone="muted">
          Масштаб VisualViewport = 1 не исключает системное масштабирование Android.
          devicePixelRatio также не показывает физический размер элементов в миллиметрах.
          Контрольные размеры измеряются на этой странице, а не внутри Navbar.
        </Text>
        <div className="settings-page__actions">
          <Button onClick={refresh}>Обновить измерения</Button>
          <Button variant="secondary" onClick={() => {
            void copyText(['Mezfit — диагностика экрана', ...rows.map(([label, value]) => `${label}: ${value}`)].join('\n'), 'Измерения скопированы');
          }}>Копировать измерения</Button>
          <Button variant="secondary" onClick={() => {
            void copyText(SCREEN_DIAGNOSTICS_DEEP_LINK, 'Ссылка скопирована');
          }}>Копировать ссылку</Button>
        </div>
        <Text variant="caption" tone="muted" className="screen-diagnostics__link">{SCREEN_DIAGNOSTICS_DEEP_LINK}</Text>
        {copyStatus ? <Text variant="footnote" role="status">{copyStatus}</Text> : null}
      </GlassSurface>
    </section>
  );
}
