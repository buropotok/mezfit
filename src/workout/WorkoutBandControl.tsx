import { useEffect, useMemo, useRef, useState } from 'react';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { FlexAttributesRepository } from '../data/cloud/flex-attributes';
import {
  Button, GlassBackgroundColorControls, IconButton, LiquidPopover, RangePicker, Text,
  type LiquidPopoverItem,
} from '../ui';
import { hsvToHex } from '../ui/colorMath';
import {
  RESISTANCE_BAND_DEFAULTS, bandFieldKey, loadResistanceBands,
  resistanceHexToHsv, saveResistanceBands,
  type ResistanceBandFieldKey, type ResistanceBandSetting,
} from '../settings/resistanceBands';
import type { ResistanceBandCode } from './setEntryTypes';
import './workout-band-control.css';

// Keep the persisted FACT band codes stable. The five editable palette rows
// have fixed personal identities; an existing legacy purple FACT is not rewritten.
const BAND_CODES: readonly ResistanceBandCode[] = ['green', 'blue', 'yellow', 'red', 'black'];
const BAND_CODE_BY_ID: Record<ResistanceBandSetting['id'], ResistanceBandCode> = {
  1: 'green', 2: 'blue', 3: 'yellow', 4: 'red', 5: 'black',
};
const bandIndex = (code: ResistanceBandCode | null) =>
  code === null ? -1 : BAND_CODES.indexOf(code);

interface WorkoutBandControlProps {
  selected: ResistanceBandCode | null;
  onSelect: (code: ResistanceBandCode | null) => void;
  disabled?: boolean;
}

export function WorkoutBandControl({ selected, onSelect, disabled = false }: WorkoutBandControlProps) {
  const cloud = useCloudConnections();
  const db = cloud?.db;
  const actorUserId = cloud?.actorUserId;
  const repository = useMemo(() => db && actorUserId
    ? new FlexAttributesRepository(db, actorUserId) : null, [db, actorUserId]);

  const [palette, setPalette] = useState<ResistanceBandSetting[]>(() =>
    RESISTANCE_BAND_DEFAULTS.map(band => ({ ...band })));
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editId, setEditId] = useState<ResistanceBandSetting['id'] | null>(null);
  const [editDraft, setEditDraft] = useState<ResistanceBandSetting | null>(null);
  const [editorOpened, setEditorOpened] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const dirtyFieldsRef = useRef<Set<ResistanceBandFieldKey>>(new Set());
  const triggerRef = useRef<HTMLButtonElement>(null);
  const active = useRef(true);

  useEffect(() => {
    active.current = true;
    if (!repository || !actorUserId) {
      setLoaded(true);
      return () => { active.current = false; };
    }
    let cancelled = false;
    setLoaded(false);
    setLoadError(false);
    void loadResistanceBands(repository, actorUserId)
      .then(bands => {
        if (cancelled) return;
        setPalette(bands);
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError(true);
        setLoaded(true);
      });
    return () => { cancelled = true; active.current = false; };
  }, [repository, actorUserId]);

  const selectedIndex = bandIndex(selected);
  const selectedBand = selectedIndex < 0 ? null : palette[selectedIndex];
  const visibleBand = loaded && !loadError ? selectedBand : null;
  const beginEdit = (id: ResistanceBandSetting['id']) => {
    if (disabled || !loaded || !repository || loadError) return;
    const band = palette.find(candidate => candidate.id === id);
    if (!band) return;
    setEditId(id);
    setEditDraft({ ...band });
    dirtyFieldsRef.current.clear();
    setSaveError('');
    // Open after the liquid close finishes; never stack two interactive popovers.
    setMenuOpen(false);
  };
  const edit = (patch: Partial<ResistanceBandSetting>) => {
    if (!editDraft || saving) return;
    for (const field of ['min', 'max', 'color'] as const) {
      if (patch[field] !== undefined && patch[field] !== editDraft[field]) {
        dirtyFieldsRef.current.add(bandFieldKey(editDraft.id, field));
      }
    }
    setEditDraft({ ...editDraft, ...patch });
  };
  const saveEdit = async () => {
    if (!repository || !actorUserId || !editDraft || saving) return;
    if (dirtyFieldsRef.current.size === 0) {
      setEditorOpened(false);
      setEditId(null);
      setEditDraft(null);
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const next = palette.map(band => band.id === editDraft.id ? { ...editDraft } : band);
      await saveResistanceBands(repository, actorUserId, next, new Set(dirtyFieldsRef.current));
      if (!active.current) return;
      setPalette(next);
      setEditorOpened(false);
      setEditId(null);
      setEditDraft(null);
      dirtyFieldsRef.current.clear();
      // The local transaction is committed; normal Dexie Cloud Addon replication
      // handles upload. No network request blocks editing or choosing a band.
    } catch {
      if (active.current) setSaveError('Не удалось сохранить параметры резинки.');
    } finally {
      if (active.current) setSaving(false);
    }
  };

  const items: LiquidPopoverItem[] = palette.map(band => ({
    id: BAND_CODE_BY_ID[band.id],
    label: `${band.min}–${band.max} кг`,
    icon: 'tilde',
    iconColor: band.color,
    active: selected === BAND_CODE_BY_ID[band.id],
    onSelect: () => onSelect(selected === BAND_CODE_BY_ID[band.id] ? null : BAND_CODE_BY_ID[band.id]),
    trailingAction: repository && !loadError ? {
      icon: 'pencil',
      label: `Изменить параметры ленты ${band.id}`,
      onSelect: () => beginEdit(band.id),
    } : undefined,
  }));
  items.push({ id: 'none', label: 'Без ленты', onSelect: () => onSelect(null) });

  return <>
    <div className="workout-band-control">
      <LiquidPopover isOpen={menuOpen} onOpenChange={setMenuOpen}
        onPresentationChange={presented => {
          if (!presented && editId !== null && !editorOpened) setEditorOpened(true);
        }}
        triggerRef={triggerRef} items={items} label="Фитнес-лента"
        trigger={<IconButton ref={triggerRef} disabled={disabled || !loaded} label={selected ? 'Изменить фитнес-ленту' : 'Выбрать фитнес-ленту'}>
          <span className="set-entry__icon set-entry__icon--ripple"
            style={{ color: visibleBand?.color }} aria-hidden="true" />
        </IconButton>} />
      {visibleBand ? <Text variant="caption">{visibleBand.min}–{visibleBand.max} кг</Text> : null}
    </div>
    {editDraft ? <RangePicker opened={editorOpened} value={{ min: editDraft.min, max: editDraft.max }}
      minAllowed={1} maxAllowed={30} target={triggerRef.current}
      onChange={range => edit(range)}
      onClose={() => { setEditorOpened(false); setEditId(null); setEditDraft(null); }}
      footer={<div className="workout-band-editor">
        <Text variant="caption">Лента {editDraft.id}</Text>
        <GlassBackgroundColorControls stacked colorSubject="ленты" color={resistanceHexToHsv(editDraft.color)}
          minimumBrightness={0} onChange={color => edit({ color: hsvToHex(color) })} />
        {saveError ? <Text variant="caption" role="alert">{saveError}</Text> : null}
        <Button onClick={() => { void saveEdit(); }} disabled={saving}>
          {saving ? 'Сохранение…' : 'Сохранить'}
        </Button>
      </div>} /> : null}
  </>;
}
