import { Button as KonstaButton } from 'konsta/react';
import { openMezfitBotChat } from '../telegram';
import { Text } from '../ui';

/** Post-invite guidance only: Dexie Cloud runs in the mounted parent provider. */
export function BotStartScreen({ onContinue }: { onContinue: () => void }) {
  return (
    <main className="center">
      <section className="card stack" aria-label="Запуск бота Mezfit">
        <Text variant="footnote">Подключение к тренеру завершено</Text>
        <Text variant="title" role="heading" aria-level={1}>Запустите бота Mezfit</Text>
        <Text variant="body">
          Откройте чат с @mezfit_bot и нажмите кнопку «Старт», чтобы получать уведомления от бота.
        </Text>
        <KonstaButton rounded strong onClick={openMezfitBotChat}>Открыть чат с ботом</KonstaButton>
        <Text variant="footnote">После нажатия «Старт» вернитесь в Mezfit.</Text>
        <KonstaButton rounded tonal onClick={onContinue}>Продолжить в Mezfit</KonstaButton>
        <Text variant="footnote">Этот шаг можно пропустить: тренировки и синхронизация доступны уже сейчас.</Text>
      </section>
    </main>
  );
}
