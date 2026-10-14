import { useEffect, useMemo, useRef, useState } from 'react';
import { Checkbox, Chip } from 'konsta/react';
import type { PublicExerciseSnapshot } from '../data/exercises/publicExerciseCatalogue';
import {
  FILTER_GROUPS, PUBLIC_EXERCISE_CATEGORIES, filterOptions, filterPublicExercises,
  type FilterGroup, type SelectedFilters,
} from '../data/exercises/publicExerciseFilters';
import type { PublicExerciseRow, PublicTaxonomyRow } from '../data/exercises/publicExerciseTypes';
import { PublicExerciseMedia } from './PublicExerciseMedia';
import { publicExerciseCategoryArtwork } from './publicExerciseCategoryArtwork';
import { useNavigationBackTransition, type NavigationContext } from '../NavigationShell';
import {
  Button, IconButton, LiquidPopover, List, ListItem,
  MezfitDialog, MezfitDialogButton, MezfitSearchbar, Surface, Text,
} from '../ui';
import './public-exercises.css';

function TablerFilter() {
  return <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16v2.172a2 2 0 0 1-.586 1.414L14 13v7l-4-2v-5L4.586 7.586A2 2 0 0 1 4 6.172V4z" /></svg>;
}

function TablerBarbell() {
  return <svg aria-hidden="true" width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12h2m2 0h12m2 0h2M4 9v6m2-9v12m12-12v12m2-9v6" /></svg>;
}

const categories = Object.fromEntries(PUBLIC_EXERCISE_CATEGORIES) as Record<string, string>;
const PAGE_SIZE = 80;

type PublishedSnapshot = Extract<PublicExerciseSnapshot, { status: 'ready' }>;

function uniqueMuscles(ids: readonly string[], taxonomy: readonly PublicTaxonomyRow[]): string {
  const labels = new Map(taxonomy.map((node) => [node.id, node.subcategory_ru]));
  return [...new Set(ids)].map((id) => labels.get(id) ?? id).join(', ') || 'Не указано';
}

function ExerciseDetail({ row, taxonomy }: { row: PublicExerciseRow; taxonomy: PublicTaxonomyRow[] }) {
  const sections: Array<[string, readonly string[]]> = [
    ['Основные мышцы', row.muscles.primary],
    ['Вспомогательные мышцы', row.muscles.secondary],
    ['Стабилизаторы', row.muscles.stabilizers],
    ['Акцент', row.muscles.emphasis],
    ['Цели подвижности', row.mobility_targets],
  ];
  return (
    <section className="mezfit-public-exercises__detail" aria-label="Детали упражнения">
      <Surface className="mezfit-public-exercises__media-placeholder">
        <PublicExerciseMedia key={`detail:${row.id}:${row.sourceSha256}`} row={row} variant="detail" />
      </Surface>
      <Text variant="headline">{row.name_ru || row.name}</Text>
      {row.name_en ? <Text variant="footnote" tone="muted">{row.name_en}</Text> : null}
      <Text variant="footnote">{categories[row.category] ?? row.category} · {row.subcategory_ru} · {row.equipment}</Text>
      <Surface className="mezfit-public-exercises__detail-section">
        <Text variant="headline">Инструкция</Text>
        {row.instruction_steps.ru.length ? (
          <ol>{row.instruction_steps.ru.map((step, i) => (
            <li key={`${row.id}-${i}`}><Text variant="body">{step}</Text></li>
          ))}</ol>
        ) : <p><Text variant="body">{row.instructions.ru}</Text></p>}
      </Surface>
      <Surface className="mezfit-public-exercises__detail-section">
        <Text variant="headline">Анатомия</Text>
        {sections.map(([title, ids]) => ids.length ? (
          <div key={title} className="mezfit-public-exercises__anatomy-line">
            <Text variant="footnote" tone="muted">{title}</Text>
            <Text>{uniqueMuscles(ids, taxonomy)}</Text>
          </div>
        ) : null)}
      </Surface>
      <Text variant="footnote" tone="muted">{row.attribution}</Text>
    </section>
  );
}

export function ExerciseCatalogContent({
  snapshot, onNavigationContextChange, mode = 'browse',
  selectedExerciseIds, onToggleExercise, selectionDisabled = false,
}: {
  snapshot: PublishedSnapshot;
  onNavigationContextChange?: (context: NavigationContext | null) => void;
  mode?: 'browse' | 'select';
  selectedExerciseIds?: ReadonlySet<string>;
  onToggleExercise?: (exerciseId: string) => void;
  selectionDisabled?: boolean;
}) {
  const { exercises, taxonomy, catalogue } = snapshot;
  const [category, setCategory] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<SelectedFilters>({});
  const [draft, setDraft] = useState<SelectedFilters>({});
  const [filterDialogGroup, setFilterDialogGroup] = useState<FilterGroup | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const requestBackTransition = useNavigationBackTransition();

  const byId = useMemo(() => new Map(exercises.map((row) => [row.id, row])), [exercises]);
  const selected = selectedId ? byId.get(selectedId) : undefined;
  const categoryLabel = category ? categories[category] ?? category : null;

  useEffect(() => {
    if (!onNavigationContextChange) return undefined;
    if (selectedId && selected) {
      onNavigationContextChange({
        title: selected.name_ru || selected.name,
        scrollKey: `exercise:${selectedId}`,
        identity: { title: selected.name_ru || selected.name, icon: 'barbell' },
        onBack: () => requestBackTransition(() => setSelectedId(null)),
      });
    } else if (category) {
      onNavigationContextChange({
        title: categoryLabel || 'Упражнения',
        scrollKey: `exercises:${category}`,
        identity: { title: categoryLabel || 'Упражнения', icon: 'barbell' },
        onBack: () => requestBackTransition(() => setCategory(null)),
      });
    } else onNavigationContextChange(null);
    return () => onNavigationContextChange(null);
  }, [category, categoryLabel, onNavigationContextChange, requestBackTransition, selected, selectedId]);

  const selectedEntries = FILTER_GROUPS.flatMap(({ id, label }) =>
    (filters[id] ?? []).map((value) => {
      const option = filterOptions(id, exercises, taxonomy, catalogue.subcategoryLabelsRu)
        .find((item) => item.id === value);
      return { group: id, value, label: `${label}: ${option?.label ?? value}` };
    }));

  const visibleExercises = useMemo(() => filterPublicExercises(
    exercises, taxonomy, filters, query, category,
  ), [exercises, taxonomy, filters, query, category]);

  const groupOptions = filterDialogGroup ? filterOptions(
    filterDialogGroup, exercises, taxonomy, catalogue.subcategoryLabelsRu,
  ) : [];

  const closeFilter = () => setFilterDialogGroup(null);
  const openFilter = (id: FilterGroup) => {
    setDraft(Object.fromEntries(Object.entries(filters).map(([key, values]) => [key, [...values]])));
    setFilterDialogGroup(id);
  };
  const toggleDraft = (id: FilterGroup, value: string, checked: boolean) => {
    setDraft((current) => {
      const next = new Set(current[id] ?? []);
      if (checked) next.add(value); else next.delete(value);
      return { ...current, [id]: [...next] };
    });
  };
  const applyFilter = () => {
    setFilters(draft);
    setVisibleLimit(PAGE_SIZE);
    closeFilter();
  };
  const removeChip = (id: FilterGroup, value: string) => {
    setFilters((current) => ({ ...current, [id]: (current[id] ?? []).filter((item) => item !== value) }));
    setVisibleLimit(PAGE_SIZE);
  };

  if (selected) return <ExerciseDetail row={selected} taxonomy={taxonomy} />;
  return (
    <section className="mezfit-public-exercises stack">
      <div className="mezfit-public-exercises__toolbar">
        <MezfitSearchbar
          placeholder="Найти упражнение"
          aria-label="Найти упражнение"
          disableButton
          value={query}
          onChange={(e) => { setQuery(e.currentTarget.value); setVisibleLimit(PAGE_SIZE); }}
          onClear={() => { setQuery(''); setVisibleLimit(PAGE_SIZE); }}
          onDisable={() => { setQuery(''); setVisibleLimit(PAGE_SIZE); }}
        />
        <LiquidPopover
          isOpen={popoverOpen}
          onOpenChange={setPopoverOpen}
          triggerRef={triggerRef}
          trigger={<IconButton ref={triggerRef} label="Фильтры"><TablerFilter /></IconButton>}
          label="Группы фильтров"
          items={FILTER_GROUPS.map(({ id, label }) => ({
            id, label,
            active: Boolean(filters[id]?.length),
            onSelect: () => openFilter(id),
          }))}
        />
      </div>

      {selectedEntries.length > 0 ? (
        <div className="mezfit-public-exercises__chips" aria-label="Активные фильтры">
          {selectedEntries.map(({ group, value, label }) => (
            <Chip key={`${group}:${value}`} deleteButton onDelete={() => removeChip(group, value)}>{label}</Chip>
          ))}
          <Button variant="secondary" size="compact" onClick={() => setFilters({})}>Сбросить</Button>
        </div>
      ) : null}

      {!category && !query.trim() && selectedEntries.length === 0 ? (
        <List className="mezfit-public-exercises__category-list">
          {PUBLIC_EXERCISE_CATEGORIES.map(([id, label]) => (
            <ListItem
              key={id}
              title={label}
              subtitle={`${exercises.filter((row) => row.category === id).length} упражнений`}
              leading={<span className="mezfit-public-exercises__category-fallback">
                {publicExerciseCategoryArtwork(id)
                  ? <img src={publicExerciseCategoryArtwork(id)!} alt="" width={72} height={72} decoding="async" />
                  : <TablerBarbell /> }
              </span>}
              onClick={() => { setCategory(id); setVisibleLimit(PAGE_SIZE); }}
            />
          ))}
        </List>
      ) : (
        <>
          <div className="mezfit-public-exercises__results-header">
            <Text variant="footnote" tone="muted">{categoryLabel ? `${categoryLabel} · ` : ''}{visibleExercises.length} упражнений</Text>
            {category ? <Button variant="secondary" size="compact" onClick={() => { setCategory(null); setVisibleLimit(PAGE_SIZE); }}>Все категории</Button> : null}
          </div>
          {visibleExercises.length ? (
            <List>
              {visibleExercises.slice(0, visibleLimit).map((row) => (
                <ListItem
                  key={row.id}
                  leadingShape="square"
                  leading={<span className="mezfit-public-exercises__exercise-fallback">
                    <PublicExerciseMedia key={`thumbnail:${row.id}:${row.sourceSha256}`} row={row} variant="thumbnail" />
                  </span>}
                  title={row.name_ru || row.name}
                  subtitle={row.name_en || row.subcategory_ru}
                  aria-pressed={mode === 'select' ? Boolean(selectedExerciseIds?.has(row.id)) : undefined}
                  disabled={mode === 'select' && selectionDisabled}
                  onClick={() => {
                    if (mode === 'select') onToggleExercise?.(row.id);
                    else setSelectedId(row.id);
                  }}
                />
              ))}
            </List>
          ) : <Surface><Text>По выбранным условиям упражнений нет.</Text></Surface>}
          {visibleExercises.length > visibleLimit ? (
            <Button variant="secondary" onClick={() => setVisibleLimit((v) => v + PAGE_SIZE)}>
              Показать ещё
            </Button>
          ) : null}
        </>
      )}
      <MezfitDialog
        opened={filterDialogGroup !== null}
        title={FILTER_GROUPS.find(({ id }) => id === filterDialogGroup)?.label ?? 'Фильтр'}
        onBackdropClick={closeFilter}
        content={<div className="mezfit-public-exercises__filter-options">
          {filterDialogGroup && groupOptions.map(({ id, label }) => (
            <label key={id} className="mezfit-public-exercises__filter-option">
              <Checkbox component="div" checked={(draft[filterDialogGroup] ?? []).includes(id)}
                onChange={(e) => toggleDraft(filterDialogGroup, id, e.target.checked)} />
              <Text>{label}</Text>
            </label>
          ))}
        </div>}
        buttons={<>
          <MezfitDialogButton onClick={closeFilter}>Отмена</MezfitDialogButton>
          <MezfitDialogButton strong onClick={applyFilter}>Применить</MezfitDialogButton>
        </>}
      />
    </section>
  );
}

