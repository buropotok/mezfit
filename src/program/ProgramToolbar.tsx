import { useState } from 'react';
import type { CloudProgramStatus } from '../data/cloud/database';
import { GlassSurface, IconButton, MezfitSearchbar, Text } from '../ui';
import { LiquidGlassTextOnly } from '../ui/LiquidGlassTextOnly';
import { loadBrowserGlassSettings } from '../glassSettings';

export type ProgramFilter = 'all' | CloudProgramStatus;
export interface ProgramControls {
  filter: ProgramFilter;
  onFilterChange: (value: ProgramFilter) => void;
  search: string;
  onSearchChange: (value: string) => void;
}
const FILTERS = [
  { value: 'all', label: 'Все' }, { value: 'active', label: 'Активные' },
  { value: 'finished', label: 'Завершённые' }, { value: 'draft', label: 'Черновики' },
  { value: 'cancelled', label: 'Отменённые' },
] as const;
export type ProgramSource = 'coach' | 'personal';
const SOURCES = [{ value: 'coach', label: 'От тренера' }, { value: 'personal', label: 'Мои программы' }];

export function ProgramToolbar({ controls, source, onSourceChange }: {
  controls: ProgramControls;
  source?: ProgramSource;
  onSourceChange?: (value: ProgramSource) => void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const glass = loadBrowserGlassSettings();
  return (
    <GlassSurface preset="modalTuned" optics={false} className="cloud-plan-toolbar">
      <div className="cloud-plan-toolbar-content">
        {source && onSourceChange ? <LiquidGlassTextOnly tabs={SOURCES} value={source} hidden={false}
          onValueChange={(value) => { if (value === 'coach' || value === 'personal') onSourceChange(value); }} /> : null}
        <div className="cloud-plan-toolbar-row">
          <div className="cloud-plan-toolbar-tabs">
            <LiquidGlassTextOnly tabs={FILTERS} value={controls.filter} hidden={false}
              onValueChange={(value) => {
                if (FILTERS.some((tab) => tab.value === value)) controls.onFilterChange(value as ProgramFilter);
              }} />
          </div>
          {!searchOpen ? <IconButton theme="glass" icon="search" label="Поиск программ"
            aria-expanded={false} onClick={() => setSearchOpen(true)} /> : null}
        </div>
        {searchOpen ? <div className="cloud-plan-search-reveal">
          <label htmlFor="program-search"><Text variant="body" className="cloud-plan-search-label">Поиск программы или атлета</Text></label>
          <MezfitSearchbar inputId="program-search" placeholder="Поиск программы или атлета"
            disableButton value={controls.search}
            glassPreset={glass.preset} glassOptics={glass.optics}
            onChange={(event) => controls.onSearchChange(event.currentTarget.value)}
            onClear={() => controls.onSearchChange('')}
            onDisable={() => { controls.onSearchChange(''); setSearchOpen(false); }} />
        </div> : null}
      </div>
    </GlassSurface>
  );
}
