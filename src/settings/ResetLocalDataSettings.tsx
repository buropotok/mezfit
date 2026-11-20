import { useEffect, useState } from 'react';
import { Toggle } from 'konsta/react';
import { Button, GlassSurface, Icon, MezfitDialog, MezfitDialogButton, Text } from '../ui';
import type { LocalDataResetSelection } from '../data/local/resetLocalData';
import { estimateLocalDataBytes, estimateMediaCacheBytes } from '../data/local/resetLocalDataSizes';
import './reset-local-data-settings.css';

type SizeResult = number | 'loading' | null;

function sizeLabel(value: SizeResult): string {
  if (value === 'loading') return 'Подсчёт…';
  if (value === null) return 'Размер недоступен';
  if (value === 0) return '0 Б';
  if (value < 1024) return `≈ ${value} Б`;
  if (value < 1024 * 1024) return `≈ ${(value / 1024).toFixed(1)} КБ`;
  return `≈ ${(value / (1024 * 1024)).toFixed(1)} МБ`;
}

export function ResetLocalDataSettings({
  glassBlur, onClear, telegramUserId = null,
}: {
  glassBlur?: number;
  onClear: (selection: LocalDataResetSelection) => void;
  telegramUserId?: string | null;
}) {
  const [media, setMedia] = useState(false);
  const [workouts, setWorkouts] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState('');
  const [mediaSize, setMediaSize] = useState<SizeResult>('loading');
  const [workoutsSize, setWorkoutsSize] = useState<SizeResult>('loading');

  useEffect(() => {
    let active = true;
    setMediaSize('loading');
    setWorkoutsSize('loading');
    if (!telegramUserId) {
      setMediaSize(null);
      setWorkoutsSize(null);
      return () => { active = false; };
    }
    void estimateMediaCacheBytes(telegramUserId)
      .then(bytes => { if (active) setMediaSize(bytes); })
      .catch(() => { if (active) setMediaSize(null); });
    void estimateLocalDataBytes(telegramUserId)
      .then(bytes => { if (active) setWorkoutsSize(bytes); })
      .catch(() => { if (active) setWorkoutsSize(null); });
    return () => { active = false; };
  }, [telegramUserId]);

  const clear = () => {
    setConfirmOpen(false);
    setError('');
    try {
      onClear({ media, workouts });
    } catch {
      setError('Не удалось запустить очистку. Повторите попытку.');
    }
  };

  return (
    <section className="settings-page" aria-label="Очистка данных">
      <GlassSurface component="section" wrapContent={false} preset="modalTuned" optics={false}
        blur={glassBlur} shape={{ radius: 16 }} className="settings-page__section">
        <Text variant="title">Очистка данных</Text>
        <Text variant="body">Выберете данные для сброса.</Text>

        <div className="local-data-reset__choices">
          <label className="local-data-reset__choice">
            <span className="local-data-reset__choice-copy">
              <Text variant="body">Кэш медиа</Text>
              <Text variant="footnote" tone="muted" aria-live="polite">{sizeLabel(mediaSize)}</Text>
            </span>
            <Toggle component="span" checked={media} onChange={() => setMedia(value => !value)} />
          </label>
          <label className="local-data-reset__choice">
            <span className="local-data-reset__choice-copy">
              <Text variant="body">Данные о программах и тренировках.</Text>
              <Text variant="footnote" tone="muted" aria-live="polite">{sizeLabel(workoutsSize)}</Text>
            </span>
            <Toggle component="span" checked={workouts} onChange={() => setWorkouts(value => !value)} />
          </label>
        </div>

        <Text variant="footnote" tone="muted">
          Размеры приблизительные: показан объём соответствующих локальных хранилищ, а не точное место на диске.
        </Text>

        <div className="local-data-reset__notice">
          <span className="local-data-reset__notice-icon"><Icon name="info-triangle" /></span>
          <Text variant="body">
            Данные будут удалены только с данного устройства. В облаке данные будут сохранены и автоматически загружены при необходимости.
          </Text>
        </div>
        {workouts && (
          <Text variant="footnote" tone="muted">
            Вместе с данными тренировок будет повторно загружена локальная копия профилей, каталога и переписок.
            Несинхронизированные изменения могут быть потеряны.
          </Text>
        )}
        {error && <Text variant="body" role="alert">{error}</Text>}
        <span className="settings-page__action">
          <Button disabled={!media && !workouts} onClick={() => setConfirmOpen(true)}>Очистить</Button>
        </span>
      </GlassSurface>

      <MezfitDialog opened={confirmOpen} role="alertdialog" aria-modal="true" aria-label="Очистить локальные данные?" onBackdropClick={() => setConfirmOpen(false)}
        title={<Text variant="headline">Очистить локальные данные?</Text>}
        content={<Text variant="body">
          Выбранные данные будут удалены с этого устройства. Несинхронизированные изменения
          и незавершённые операции могут быть потеряны. Mezfit перезапустится.
        </Text>}
        buttons={<>
          <MezfitDialogButton onClick={() => setConfirmOpen(false)}>Отмена</MezfitDialogButton>
          <MezfitDialogButton tone="danger" onClick={clear}>Очистить</MezfitDialogButton>
        </>}
      />
    </section>
  );
}
