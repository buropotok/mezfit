import { useState } from 'react';
import type { CloudProgramStatus } from '../data/cloud/database';
import { IconButton, MezfitSearchbar, Text } from '../ui';
import { LiquidGlassTextOnly } from '../ui/LiquidGlassTextOnly';

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
export function ProgramToolbar({ controls, showSearch = true }: {
  controls: ProgramControls;
  showSearch?: boolean;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  return (
    <div className="cloud-plan-toolbar">
      <div className="cloud-plan-toolbar-tabs">
        <LiquidGlassTextOnly tabs={FILTERS} value={controls.filter} hidden={false}
          onValueChange={(value) => {
            if (FILTERS.some((tab) => tab.value === value)) controls.onFilterChange(value as ProgramFilter);
          }} />
      </div>
      {showSearch ? (
        <>
          {!searchOpen ? (
            <div className="cloud-plan-toolbar-search-action">
              <IconButton theme="glass" icon="search" label="Поиск программ"
                aria-expanded={false} onClick={() => setSearchOpen(true)} />
            </div>
          ) : (
            <div className="cloud-plan-search-reveal">
              <label htmlFor="program-search"><Text variant="body" className="cloud-plan-search-label">Поиск программы или атлета</Text></label>
              <MezfitSearchbar inputId="program-search" placeholder="Поиск программы или атлета"
                disableButton value={controls.search}
                glassPreset="modalTuned" glassOptics={false}
                onChange={(event) => controls.onSearchChange(event.currentTarget.value)}
                onClear={() => controls.onSearchChange('')}
                onDisable={() => { controls.onSearchChange(''); setSearchOpen(false); }} />
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
