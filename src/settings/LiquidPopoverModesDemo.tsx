import { useRef, useState } from 'react';
import {
  IconButton,
  LiquidPopover,
  Text,
  resolveLiquidPopoverRenderMode,
  type LiquidPopoverItem,
} from '../ui';

export function LiquidPopoverModesDemo() {
  const svgTriggerRef = useRef<HTMLButtonElement>(null);
  const canvasTriggerRef = useRef<HTMLButtonElement>(null);
  const [svgOpen, setSvgOpen] = useState(false);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [lastAction, setLastAction] = useState('Действие не выбрано');

  const items = (mode: 'SVG' | 'Canvas'): LiquidPopoverItem[] => [
    { id: 'edit', label: 'Редактировать', onSelect: () => setLastAction(`${mode}: Редактировать`) },
    { id: 'copy', label: 'Создать копию', onSelect: () => setLastAction(`${mode}: Создать копию`) },
    { id: 'disabled', label: 'Недоступное действие', disabled: true },
    { id: 'close', label: 'Закрыть', dividerBefore: true },
  ];

  const automaticMode = resolveLiquidPopoverRenderMode('auto');

  return (
    <section className="modules-gallery__example" aria-labelledby="module-liquid-popover-title">
      <Text id="module-liquid-popover-title" variant="headline">Liquid Popover — сравнение режимов</Text>
      <Text variant="footnote" tone="muted">
        Одинаковые меню с разной обрезкой текстуры. В приложении выбирается автоматически:
        {' '}{automaticMode === 'canvas' ? 'Canvas (iOS)' : 'SVG (другие платформы)'}.
        В примерах режимы принудительно зафиксированы для сравнения на одном устройстве.
      </Text>
      <div className="modules-gallery__popover-comparison">
        <div className="modules-gallery__popover-mode">
          <Text variant="footnote">SVG clip-path — исходный</Text>
          <LiquidPopover
            isOpen={svgOpen}
            onOpenChange={(open) => {
              setSvgOpen(open);
              if (open) setCanvasOpen(false);
            }}
            triggerRef={svgTriggerRef}
            trigger={<IconButton ref={svgTriggerRef} icon="dots-vertical" label="Открыть SVG Popover" />}
            renderMode="svg"
            label="SVG Popover"
            items={items('SVG')}
          />
        </div>
        <div className="modules-gallery__popover-mode">
          <Text variant="footnote">Canvas clip — iOS</Text>
          <LiquidPopover
            isOpen={canvasOpen}
            onOpenChange={(open) => {
              setCanvasOpen(open);
              if (open) setSvgOpen(false);
            }}
            triggerRef={canvasTriggerRef}
            trigger={<IconButton ref={canvasTriggerRef} icon="dots-vertical" label="Открыть Canvas Popover" />}
            renderMode="canvas"
            label="Canvas Popover"
            items={items('Canvas')}
          />
        </div>
      </div>
      <Text variant="caption" tone="muted">{lastAction}</Text>
    </section>
  );
}
