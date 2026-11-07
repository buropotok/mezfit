import { useEffect, useRef, useState } from 'react';
import { Button } from 'konsta/react';
import type { DiscussionReadDiagnosticReport } from '../data/cloud/discussion-read-diagnostics';
import { Text } from '../ui';

export function DiscussionReadDiagnostic({ report, failed }: {
  report: DiscussionReadDiagnosticReport | null; failed: boolean;
}) {
  const mounted = useRef(false);
  const [copyStatus, setCopyStatus] = useState('');
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const copy = async () => {
    if (!report || failed) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      if (mounted.current) setCopyStatus('Отчёт скопирован');
    } catch {
      if (mounted.current) setCopyStatus('Не удалось скопировать. Можно отправить снимок этого раздела.');
    }
  };
  return <section aria-label="Диагностика отметок прочтения">
    <p><Text variant="headline">Отметки прочтения</Text></p>
    {failed ? <p role="alert"><Text variant="body">Не удалось прочитать отметки прочтения.</Text></p> : null}
    {report ? <>
      <p><Text variant="body">Таблицы доступны: {report.tablesAvailable ? 'да' : 'нет'}. Синхронизация отметок включена: {report.readStatesSynced === null ? 'не определено' : report.readStatesSynced ? 'да' : 'нет'}</Text></p>
      <p><Text variant="body">Обсуждений: {report.threads}, некорректных: {report.invalidThreads}</Text></p>
      <p><Text variant="body">Мои отметки: {report.ownStates}, приняты: {report.acceptedOwnStates}</Text></p>
      <p><Text variant="body">Отметки собеседников: {report.peerStates}, приняты: {report.acceptedPeerStates}</Text></p>
      <p><Text variant="body">Исходящих: {report.outgoing}, с отметкой собеседника в той же ветке: {report.outgoingWithPeerState}, прочитанных: {report.outgoingRead}</Text></p>
      <p><Text variant="body">Входящих: {report.incoming}, прочитанных локально: {report.incomingReadLocally}</Text></p>
      <p><Text variant="body">Отклонено: идентичность {report.rejected.identity}, владелец {report.rejected.owner}, ветка/realm {report.rejected.threadOrRealm}, нет курсора {report.rejected.missingCursor}, формат курсора {report.rejected.invalidCursor}, сообщение курсора {report.rejected.cursorMessageMismatch}</Text></p>
      <p><Text variant="body">Некорректных сообщений: {report.invalidMessages}</Text></p>
      <Button rounded onClick={copy} disabled={failed}>Скопировать отчёт о прочтении</Button>
      <p role="status"><Text variant="footnote">{copyStatus}</Text></p>
    </> : !failed ? <p><Text variant="body">Читаем локальные отметки…</Text></p> : null}
    <p><Text variant="footnote" tone="muted">Это локальные данные данного устройства после обычной синхронизации. Отчёт содержит только количества и настройки; наличие данных на сервере он не подтверждает.</Text></p>
  </section>;
}
