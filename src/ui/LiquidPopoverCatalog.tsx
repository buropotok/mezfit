import { forwardRef, useRef, useState, type ButtonHTMLAttributes } from 'react';
import { GlassSurface } from './GlassSurface';
import { LiquidPopover, type LiquidPopoverItem } from './LiquidPopover';
import { MezfitNavbar } from './MezfitNavbar';
import { Divider, Surface, Text } from './primitives';
import { LIQUID_POPOVER_DEFAULTS } from './liquidPopoverGeometry';

const RoundTrigger = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement>
>((props, ref) => <button {...props} ref={ref} type="button" />);
RoundTrigger.displayName = 'LiquidPopoverRoundTrigger';

export function LiquidPopoverCatalog() {
  const navbarRef = useRef<HTMLElement>(null),
    roundRef = useRef<HTMLElement>(null);
  const [navbarOpen, setNavbarOpen] = useState(false),
    [roundOpen, setRoundOpen] = useState(false);
  const [sourceMorph, setSourceMorph] = useState(
    LIQUID_POPOVER_DEFAULTS.sourceMorph,
  );
  const [selection, setSelection] = useState('Выбери пункт меню');
  const motion = { sourceMorph };
  const items = (close: () => void): LiquidPopoverItem[] => [
    {
      id: 'edit',
      label: 'Редактировать',
      onSelect: () => {
        setSelection('Редактировать');
        close();
      },
    },
    {
      id: 'copy',
      label: 'Создать копию',
      onSelect: () => {
        setSelection('Создать копию');
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
        rightControlHidden={navbarOpen}
        menuDisabled={navbarOpen}
        renderMenuControl={(control) => (
          <LiquidPopover
            trigger={control}
            triggerRef={navbarRef}
            isOpen={navbarOpen}
            onOpenChange={(open) => {
              if (!open) setNavbarOpen(false);
            }}
            items={items(() => setNavbarOpen(false))}
            motion={motion}
            label="Живое меню Navbar"
          />
        )}
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--ui-space-3)',
          padding: 'var(--ui-space-4)',
        }}
      >
        <LiquidPopover
          triggerRef={roundRef}
          isOpen={roundOpen}
          onOpenChange={setRoundOpen}
          items={items(() => setRoundOpen(false))}
          motion={motion}
          label="Живое меню круглой кнопки"
          align="start"
          trigger={
            <GlassSurface
              component={RoundTrigger}
              ref={roundRef}
              preset="frosted"
              shape="capsule"
              optics={false}
              aria-label="Открыть живое меню"
              style={{
                width: 44,
                height: 44,
                visibility: roundOpen ? 'hidden' : undefined,
              }}
            >
              ⋯
            </GlassSurface>
          }
        />
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
