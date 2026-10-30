import { useEffect, useMemo, useRef, useState } from 'react';
import { useCloudConnections } from '../data/cloud/CloudConnectionsProvider';
import { FlexAttributesRepository } from '../data/cloud/flex-attributes';
import { Button, GlassBackgroundColorControls, GlassSurface, RangePicker, Text } from '../ui';
import { hsvToHex } from '../ui/colorMath';
import {
  RESISTANCE_BAND_DEFAULTS,
  bandFieldKey,
  loadResistanceBands,
  mergeResistanceBands,
  resistanceHexToHsv,
  saveResistanceBands,
  type ResistanceBandSetting,
  type ResistanceBandFieldKey,
} from './resistanceBands';
import './resistance-bands-settings.css';

type Status = 'loading' | 'ready' | 'saving' | 'synced' | 'pending' | 'error';

export function ResistanceBandsSettings({ glassBlur }: { glassBlur?: number }) {
  const cloud = useCloudConnections();
  const db = cloud?.db;
  const actorUserId = cloud?.actorUserId;
  const repo = useMemo(() => db && actorUserId
    ? new FlexAttributesRepository(db, actorUserId) : null, [db, actorUserId]);
  const [bands, setBands] = useState<ResistanceBandSetting[]>(() =>
    RESISTANCE_BAND_DEFAULTS.map(band => ({ ...band })));
  const [status, setStatus] = useState<Status>('loading');
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<ResistanceBandSetting['id'] | null>(null);
  const [picker, setPicker] = useState<{ id: ResistanceBandSetting['id']; target: HTMLElement } | null>(null);
  const [error, setError] = useState('');
  const savingRef = useRef(false);
  const activeRef = useRef(false);
  const dirtyFieldsRef = useRef<Set<ResistanceBandFieldKey>>(new Set());
  const saveRevisionRef = useRef(0);

  useEffect(() => {
    let active = true;
    activeRef.current = true;
    setStatus('loading');
    setLoaded(false);
    dirtyFieldsRef.current.clear();
    saveRevisionRef.current = 0;
    setError('');
    if (!repo || !actorUserId) {
      setStatus('error');
      setError('Для настройки лент необходимо войти в Dexie Cloud.');
      return () => { active = false; activeRef.current = false; };
    }
    void (async () => {
      try {
        // Display already-synced offline values immediately. A pull may update
        // them, but only before the user begins editing this screen.
        const local = await loadResistanceBands(repo, actorUserId);
        if (!active) return;
        setBands(local);
        setLoaded(true);
        setStatus('ready');
        try {
          if (!db) return;
          const startingSaveRevision = saveRevisionRef.current;
          await db.cloud.sync({ purpose: 'pull', wait: true });
          const refreshed = await loadResistanceBands(repo, actorUserId);
          if (active && !savingRef.current && saveRevisionRef.current === startingSaveRevision) {
            setBands(current => {
              const merged = mergeResistanceBands(refreshed, current, dirtyFieldsRef.current);
              // A newer remote endpoint may conflict with the edited bound.
              // Keep the valid draft and refuse save until the user resolves it.
              if (merged.some(band => band.min > band.max)) {
                setError('Диапазон изменился на другом устройстве. Откройте настройки заново.');
                return current;
              }
              return merged;
            });
          }
        } catch {
          // Offline local settings remain usable and accurately reported below.
        }
      } catch {
        if (active) {
          setStatus('error');
          setError('Не удалось загрузить настройки лент.');
        }
      }
    })();
    return () => {
      active = false;
      activeRef.current = false;
    };
  }, [repo, actorUserId, db]);

  const changeBand = (id: ResistanceBandSetting['id'], patch: Partial<ResistanceBandSetting>) => {
    if (savingRef.current) return;
    for (const field of ['color', 'min', 'max'] as const) {
      if (patch[field] !== undefined && patch[field] !== bands[id - 1][field]) {
        dirtyFieldsRef.current.add(bandFieldKey(id, field));
      }
    }
    setStatus('ready');
    setError('');
    setBands(previous => previous.map(band => band.id === id ? { ...band, ...patch, id } : band));
  };

  const save = async () => {
    if (!repo || !db || !actorUserId || !loaded || savingRef.current || status === 'loading') return;
    savingRef.current = true;
    saveRevisionRef.current += 1;
    const changed = new Set(dirtyFieldsRef.current);
    setStatus('saving');
    setError('');
    try {
      await saveResistanceBands(repo, actorUserId, bands, changed);
      if (!activeRef.current) return;
      // Sync success and local success are different outcomes.
      try {
        await db.cloud.sync({ purpose: 'push', wait: true });
        if (activeRef.current) {
          // Preserve the current snapshot; an old pull cannot overwrite it.
          dirtyFieldsRef.current.clear();
          setStatus('synced');
        }
      } catch {
        if (activeRef.current) {
          setStatus('pending');
          setError('Изменения сохранены на устройстве, но отправка в облако не подтверждена.');
        }
      }
    } catch {
      if (activeRef.current) {
        setStatus('error');
        setError('Не удалось сохранить настройки лент. Проверьте значения и повторите.');
      }
    } finally {
      savingRef.current = false;
    }
  };

  const selected = bands.find(band => band.id === editing);
  return (
    <section className="settings-page" aria-label="Настройки фитнес-лент">
      <GlassSurface component="section" preset="modalTuned" optics={false} blur={glassBlur}
        wrapContent={false} shape={{ radius: 16 }} className="settings-page__section">
        <Text variant="title">Фитнес-ленты</Text>
        <Text variant="footnote" tone="muted">
          Пять личных резинок. Выберите диапазон нагрузки от 1 до 30 кг и цвет.
          Данные сохраняются в Dexie Cloud и доступны после повторного входа.
        </Text>
        <div className="resistance-bands__list">
          {bands.map(band => (
            <div className="resistance-bands__row" key={band.id}>
              <span className="resistance-bands__swatch" style={{ backgroundColor: band.color }} aria-hidden="true" />
              <Text variant="body">Лента {band.id}</Text>
              <Button
                variant={editing === band.id ? 'primary' : 'secondary'}
                disabled={!loaded || status === 'saving' || status === 'loading'}
                aria-label={`Изменить диапазон ленты ${band.id}`}
                onClick={(event) => {
                  setEditing(band.id);
                  setPicker({ id: band.id, target: event.currentTarget });
                }}
              >{band.min}–{band.max} кг</Button>
            </div>
          ))}
        </div>
        {selected ? (
          <div className="resistance-bands__color" role="group" aria-label={`Изменить цвет ленты ${selected.id}`}>
            <Text variant="headline">Лента {selected.id}</Text>
            <Text variant="footnote" tone="muted">Цветовая настройка</Text>
            <GlassBackgroundColorControls
              color={resistanceHexToHsv(selected.color)}
              minimumBrightness={0}
              onChange={(color) => changeBand(selected.id, { color: hsvToHex(color) })}
            />
          </div>
        ) : null}
        {picker ? (
          <RangePicker
            opened
            value={bands[picker.id - 1]}
            target={picker.target}
            onChange={range => changeBand(picker.id, range)}
            onClose={() => setPicker(null)}
          />
        ) : null}
        <div className="settings-page__actions">
          <Button onClick={() => { void save(); }} disabled={!repo || !loaded || status === 'saving' || status === 'loading'}>
            {status === 'saving' ? 'Сохраняем…' : 'Сохранить ленты'}
          </Button>
          <Button variant="secondary" disabled={!loaded || status === 'saving' || status === 'loading'}
            onClick={() => {
              for (const band of RESISTANCE_BAND_DEFAULTS) {
                for (const field of ['color', 'min', 'max'] as const) {
                  dirtyFieldsRef.current.add(bandFieldKey(band.id, field));
                }
              }
              setPicker(null);
              setBands(RESISTANCE_BAND_DEFAULTS.map(band => ({ ...band })));
              setStatus('ready');
              setError('');
            }}>
            Вернуть исходные значения
          </Button>
        </div>
        <p role="status"><Text variant="footnote">
          {status === 'loading' ? 'Загрузка настроек…'
            : status === 'saving' ? 'Сохраняем изменения…'
              : status === 'synced' ? 'Настройки отправлены в Dexie Cloud.'
                : status === 'pending' ? 'Ожидается синхронизация.'
                  : status === 'error' ? 'Не удалось завершить операцию с настройками.'
                    : 'Измените настройки и нажмите «Сохранить ленты».'}
        </Text></p>
        {error ? <Text variant="footnote" role="alert">{error}</Text> : null}
      </GlassSurface>
    </section>
  );
}
