import { useState } from 'react';
import { Toggle } from 'konsta/react';
import { Button, GlassSurface, Icon, MezfitDialog, MezfitDialogButton, Text } from '../ui';
import type { LocalDataResetSelection } from '../data/local/resetLocalData';
import './reset-local-data-settings.css';

export function ResetLocalDataSettings({
  glassBlur, onClear,
}: {
  glassBlur?: number;
  onClear: (selection: LocalDataResetSelection) => void;
}) {
  const [media, setMedia] = useState(false);
  const [workouts, setWorkouts] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState('');

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
            <Text variant="body">Кэш медиа</Text>
            <Toggle component="span" checked={media} onChange={() => setMedia(value => !value)} />
          </label>
          <label className="local-data-reset__choice">
            <Text variant="body">Данные о программах и тренировках.</Text>
            <Toggle component="span" checked={workouts} onChange={() => setWorkouts(value => !value)} />
          </label>
        </div>

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

      <MezfitDialog opened={confirmOpen} onBackdropClick={() => setConfirmOpen(false)}
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
