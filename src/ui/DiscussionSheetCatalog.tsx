import { useState } from 'react';
import type { NavigationContext } from '../NavigationShell';
import { DiscussionSheet } from '../discussions';
import { Button, Text } from './index';
import { createDiscussionPreviewPort, previewDiscussionAnchor, previewDiscussionThread } from './discussion-preview';

// The standalone UI Kit route has no NavigationShell; the Sheet owns its close button.
const previewNavigation = (_context: NavigationContext | null) => {};

const resolvePreviewAuthor = (userId: string) => ({
  name: userId === 'tg:101' ? 'Тренер' : 'Спортсмен',
});

/** Real COMM-05 sheet with disposable catalogue data, not a separate chat renderer. */
export function DiscussionSheetCatalog() {
  const [repository, setRepository] = useState(createDiscussionPreviewPort);
  const [opened, setOpened] = useState(false);
  const [showAvatars, setShowAvatars] = useState(false);
  const [focusMessageId, setFocusMessageId] = useState<string | undefined>();

  const open = (focus?: string) => {
    setFocusMessageId(focus);
    setOpened(true);
  };

  return <>
    <Text variant="footnote" tone="muted">Настоящий DiscussionSheet с тестовыми сообщениями в памяти страницы.
      Dexie Cloud не подключается; одиночные и двойные галочки — демонстрационные статусы.</Text>
    <div className="ui-kit-row">
      <Button variant={showAvatars ? 'secondary' : 'primary'} aria-pressed={!showAvatars}
        onClick={() => setShowAvatars(false)}>Без аватаров · основной</Button>
      <Button variant={showAvatars ? 'primary' : 'secondary'} aria-pressed={showAvatars}
        onClick={() => setShowAvatars(true)}>С аватарами · групповой</Button>
    </div>
    <Text variant="caption" tone="muted">Проверьте длинные и многострочные сообщения, ответы с цитатами,
      время внутри пузырей, прокрутку под стеклянной панелью, ввод пяти строк и внутреннюю прокрутку,
      а также открытие системной клавиатуры на Android/iOS. Источник в панели обозначен «Демо».</Text>
    <div className="ui-kit-row">
      <Button onClick={() => open()}>Открыть переписку</Button>
      <Button variant="secondary" onClick={() => open('preview-2')}>Открыть с фокусом на ответе</Button>
      <Button variant="secondary" disabled={opened} onClick={() => setRepository(createDiscussionPreviewPort())}>
        Сбросить демо
      </Button>
    </div>
    <DiscussionSheet
      opened={opened}
      repository={repository}
      threadId={previewDiscussionThread.id}
      anchor={previewDiscussionAnchor}
      focusMessageId={focusMessageId}
      showAvatars={showAvatars}
      onClose={() => setOpened(false)}
      resolveAuthor={resolvePreviewAuthor}
      parentNavigation={null}
      onNavigationContextChange={previewNavigation}
    />
  </>;
}
