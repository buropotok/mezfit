import { forwardRef, useRef, useState, type ButtonHTMLAttributes } from 'react';
import { GlassSurface } from './GlassSurface';
import { LiquidPopover, type LiquidPopoverItem } from './LiquidPopover';
import { MezfitNavbar } from './MezfitNavbar';
import { Divider, Surface, Text } from './primitives';
import { LIQUID_POPOVER_DEFAULTS, type LiquidMotionOptions } from './liquidPopoverGeometry';
import { resolveLiquidPopoverRenderMode, type LiquidPopoverRenderMode } from './liquidPopoverRenderMode';

const RoundTrigger = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement>
>((props, ref) => <button {...props} ref={ref} type="button" />);
RoundTrigger.displayName = 'LiquidPopoverRoundTrigger';

const comparisonModes = [
  { mode: 'auto', label: 'Auto' },
  { mode: 'svg', label: 'SVG' },
  { mode: 'canvas', label: 'Canvas' },
] as const satisfies readonly { mode: LiquidPopoverRenderMode; label: string }[];

function RoundPopoverModeExample({
  mode,
  label,
  isOpen,
  onOpenChange,
  items,
  motion,
}: {
  mode: LiquidPopoverRenderMode;
  label: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  items: readonly LiquidPopoverItem[];
  motion: Partial<LiquidMotionOptions>;
}) {
  const triggerRef = useRef<HTMLElement>(null);
  return (
    <div style={{ display: 'grid', gap: 'var(--ui-space-2)', justifyItems: 'start' }}>
      <Text variant="footnote">{label}</Text>
      <LiquidPopover
        renderMode={mode}
        triggerRef={triggerRef}
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        items={items}
        motion={motion}
        label={`Liquid Popover ${label}`}
        trigger={
          <GlassSurface
            component={RoundTrigger}
            ref={triggerRef}
            preset="frosted"
            shape="capsule"
            optics={false}
            aria-label={`Открыть Liquid Popover ${label}`}
            style={{ width: 44, height: 44 }}
          >
            ⋯
          </GlassSurface>
        }
      />
    </div>
  );
}

export function LiquidPopoverCatalog() {
  const navbarRef = useRef<HTMLElement>(null);
  const [navbarOpen, setNavbarOpen] = useState(false),
    [navbarPresented, setNavbarPresented] = useState(false),
    [comparisonOpen, setComparisonOpen] = useState<LiquidPopoverRenderMode | null>(null);
  const [sourceMorph, setSourceMorph] = useState(
    LIQUID_POPOVER_DEFAULTS.sourceMorph,
  );
  const [selection, setSelection] = useState('Выбери пункт меню');
  const motion = { sourceMorph };
  const items = (close: () => void, source?: string): LiquidPopoverItem[] => [
    {
      id: 'edit',
      label: 'Редактировать',
      onSelect: () => {
        setSelection(source ? `${source}: Редактировать` : 'Редактировать');
        close();
      },
    },
    {
      id: 'copy',
      label: 'Создать копию',
      onSelect: () => {
        setSelection(source ? `${source}: Создать копию` : 'Создать копию');
        close();
      },
    },
    { id: 'unavailable', label: 'Недоступное действие', disabled: true },
    { id: 'close', label: 'Закрыть', dividerBefore: true, onSelect: close },
  ];
  return (
    <Surface as="section" className="ui-kit-section">
      <Text variant="title">Liquid Popover</Text>
      <Divider />
      <Text tone="muted">
        Один компонент: правая капсула Navbar и круглая кнопка. Размер меню
        задаётся содержимым.
      </Text>
      <MezfitNavbar
        level={1}
        identity={{ title: 'Живое меню', icon: 'users' }}
        onBack={() => {}}
        onCalendar={() => setSelection('Календарь')}
        onMenu={() => setNavbarOpen(true)}
        rightControlRef={navbarRef}
        rightControlHidden={navbarOpen || navbarPresented}
        menuDisabled={navbarOpen || navbarPresented}
        renderMenuControl={(control) => (
          <LiquidPopover
            trigger={control}
            triggerActivation="controlled"
            triggerRef={navbarRef}
            isOpen={navbarOpen}
            onOpenChange={(open) => {
              if (!open) setNavbarOpen(false);
            }}
            onPresentationChange={setNavbarPresented}
            items={items(() => setNavbarOpen(false))}
            motion={motion}
            label="Живое меню Navbar"
          />
        )}
      />
      <div style={{ display: 'grid', gap: 'var(--ui-space-3)', padding: 'var(--ui-space-4)' }}>
        <Text variant="headline">Сравнение режимов</Text>
        <Text variant="footnote" tone="muted">
          Auto выбирает {resolveLiquidPopoverRenderMode('auto') === 'canvas'
            ? 'Canvas (iOS)' : 'SVG (другая платформа)'}. SVG и Canvas
          принудительно используют выбранный рендер на любом устройстве.
        </Text>
        <div className="ui-kit-row">
          {comparisonModes.map(({ mode, label }) => (
            <RoundPopoverModeExample
              key={mode}
              mode={mode}
              label={label}
              isOpen={comparisonOpen === mode}
              onOpenChange={(open) => {
                setComparisonOpen((current) => open ? mode : current === mode ? null : current);
              }}
              items={items(() => setComparisonOpen(null), label)}
              motion={motion}
            />
          ))}
        </div>
        <Text variant="footnote">{selection}</Text>
      </div>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--ui-space-3)',
        }}
      >
        <Text variant="footnote">Сжатие кнопки</Text>
        <input
          aria-label="Время сжатия кнопки"
          type="range"
          min="10"
          max="300"
          step="10"
          value={Math.round(sourceMorph * 1000)}
          onChange={(event) =>
            setSourceMorph(Number(event.target.value) / 1000)
          }
        />
        <Text variant="footnote">{Math.round(sourceMorph * 1000)} мс</Text>
      </label>
    </Surface>
  );
}
