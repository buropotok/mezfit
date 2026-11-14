import { Button as KonstaButton } from 'konsta/react';
import { openMezfitBotChat } from '../telegram';
import { Text } from '../ui';

/** Post-invite guidance only: Dexie Cloud runs in the mounted parent provider. */
export function BotStartScreen({ onContinue }: { onContinue: () => void }) {
  return (
    <main className="center">
      <section className="card stack" aria-label="Активация Mezfit">
        <Text variant="footnote">Подключение к тренеру завершено</Text>
        <Text variant="title" role="heading" aria-level={1}>Активируйте Mezfit</Text>
        <Text variant="body">
          Чтобы получать сообщения от тренера и уведомления о тренировках, откройте чат Mezfit и нажмите «Старт».
        </Text>
        <KonstaButton rounded strong onClick={openMezfitBotChat}>Открыть чат Mezfit</KonstaButton>
        <Text variant="footnote">После нажатия «Старт» вернитесь в Mezfit.</Text>
        <KonstaButton rounded tonal onClick={onContinue}>Продолжить в Mezfit</KonstaButton>
        <Text variant="footnote">Этот шаг можно пропустить: тренировки и синхронизация доступны уже сейчас.</Text>
      </section>
    </main>
  );
}
