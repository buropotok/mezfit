# COMM-04: репозиторий обсуждений

Задача: [#639](https://github.com/buropotok/mezfit/issues/639). Основа main: 0ed9ea6d.
[COMM-03 Apply 42261608617](https://github.com/buropotok/mezfit/actions/runs/42261608617)
прошёл полный readback. Это подтверждение конфигурации, не действий обычных аккаунтов.
В COMM-04 нет production вызовов, schema/ACL Apply, UI, медиа, push или нового backend.

## Владение и операции

DiscussionRepository получает существующий account-owned db, проверенный actorUserId
и один DiscussionScope. Scope — селектор, не доказательство доступа. Каждая локальная
транзакция проверяет personal realm либо канонический realm пары, двух accepted
участников Coach/Client и участие actor через прежний isApprovedAssignedPair.
Серверная авторизация остаётся у Dexie Cloud. История бывшей пары сохраняет прежнюю
membership; другой тренер её не получает.

Anchor передаётся из типизированных адаптеров COMM-03, проверяется canonical key.
Repository не меняет и не переутверждает PLAN/FACT или статус источника. Исчезновение
источника не перепривязывает историю: сохранены threadId/anchor/title; будущий UI
честно показывает недоступный источник. Anchor не является новым grant-деревом.

- prepareDiscussionThread создаёт UUID-команду и title по имени сущности и локальной
  календарной дате. createThread идемпотентен по ID; несколько команд создают несколько веток.
- prepareDiscussionMessage создаёт стабильную команду. Вызывающий код сохраняет её ID
  для retry, не генерирует новую отправку при каждом повторе.
- saveDraft/getDraft/discardDraft хранят неотправленный текст в discussionMessages
  личного realm автора с draftForRealmId. Draft синхронизируется только лично и не
  входит в published page/unread, в том числе для personal threads.
- send принимает текст локально, без HTTP/awaited push. Draft перемещается в realm пары
  тем же ID. Повтор не затирает поздний edit/tombstone. Пустой/пробельный text отвергается;
  attachment-only отправка относится к будущему media workflow.
- edit/remove изменяют только отдельные поля собственных сообщений. Истории редакций нет.
- page/getMessage/listThreads/unread/unreadForAnchor используют realm/thread/anchor
  indexes; page ограничена 100 сообщениями. Нет сканирования всех 5000 отношений.
- observePage/observeAnchor — Dexie.liveQuery с unsubscribe и error callback.
  Наблюдаются и текущие originals для цитат. Actor/scope связываются с lifecycle аккаунта.

Физическое удаление — только для своего неотправленного draft. Save/cancel/send draft
используют declarative where predicates по ID, личному realm и marker: позднее offline
действие не должно затереть или физически удалить уже отправленную реплику.

## Reply, конфликты и read-state

Reply хранит ссылку, не вторую копию текста. Проекция цитаты — authorUserId + первая
строка оригинала до 160 символов. Изменение оригинала обновляет quote; tombstone
очищает quote, отсутствующий оригинал даёт unavailable. Существующий reply можно
редактировать/удалять и после исчезновения оригинала; ссылка при этом не меняется.
Вложенного дерева нет. Отображение имени автора/ellipsis/меню — следующие UI этапы.

Новые active сообщения имеют deletedAt: '' — технический string sentinel для
sync-consistent edit predicate. Edit использует where id/realm/thread/owner/author/
deletedAt='' + declarative modify; remove устанавливает timestamp и text=''.
Штатные операции не сбрасывают tombstone. Reader маскирует text/quote удалённой
реплики даже при остаточном сыром text после merge. Native owner по-прежнему имеет
полный контроль собственной строки; серверной immutable provenance не заявляется.

markRead имеет один детерминированный ID realm/thread/user. readThrough — createdAt/id
watermark. Indexed range below requested cursor + modify выражает условие продвижения
для Addon. Собственные сообщения и tombstones не входят в unread. Тот же порядок
createdAt/id используется страницами, включая одинаковые timestamps. Поздно
синхронизированные сообщения ниже watermark считаются прочитанными по cursor-семантике.

Основа: [consistency](https://dexie.org/docs/cloud/consistency) и
[best practices](https://dexie.org/docs/cloud/best-practices) Dexie Cloud.
Локальные соединения и проекции не доказывают серверную обработку двух настоящих
offline устройств: матрица ниже обязательна, особенно первое создание read-state
одновременно на двух устройствах.

## Версии и честные состояния синхронизации

Исторические v14/v15 не переписаны. Только opt-in добавляет v16: локальные индексы
discussionMessages.[realmId+threadId+createdAt+id] и discussionReadStates.[id+readThrough].
Условные modify/delete также имеют точные compound indexes: thread id/activity,
message id/realm/owner/draft marker, id/realm/thread/owner/author/deletedAt и
id/realm/owner. Это сохраняет declarative predicates в поддерживаемом Addon пути.
Для строковых timestamps/IDs диапазоны используют пустые строки снизу и единственный
array sentinel сверху. Один и тот же array-valued Dexie.maxKey нельзя дважды помещать
в составной ключ: IndexedDB key conversion отклоняет повторную ссылку как DataError.
Cloud primary keys/tables/ACL не меняются, повторный Apply не требуется.
Default factory/provider остаются на v14. Repository отказывает без новых индексов.
Новой БД, скрытой unsynced chat table или массовой активации нет.

Контролируемый пилот использует тот же account db через createCloudDatabase с
третьим аргументом { discussions: true }. Этот opt-in не включён текущим приложением.
После upgrade нельзя открывать тот же IndexedDB старой v14 схемой. Старые v15 rows
сохраняются; read-state без валидного readThrough требует валидации, а не сброса.
COMM-03 не имел штатного writer таких cursor rows. Старое active сообщение без
sentinel читается; оно не переписывается whole-row ради новой операции.

DiscussionSync хранит только session-local acknowledgement, без второй очереди.
После локального commit — local; Addon владеет фоновой передачей. Наблюдение in-sync
инициирует публичный push barrier и подтверждает только captured revision. Новая
правка во время ожидания остаётся local. Ошибка видна как error, sync.retry вызывает
тот же публичный push без повторного создания сообщения. Нет своих таймеров/transport/
replay; после перезапуска прежнее acknowledgement не выдумывается. Synced — подтверждение
push account database, не индивидуальная доставка и не прочтение адресатом.

## Проверки и пилот перед массовой активацией

Подготовлены CI тесты retry/draft/reopen, пустого text, own/foreign writes, двух тренеров
и personal history, динамического quote после edit/delete/missing original, unread,
pagination ties, двух локальных соединений, malformed cached rows, v15→v16, default v14,
liveQuery и captured revision/stale sync failure. Старые тесты не изменялись.
Локальные npm/typecheck/build/tests не запускались. Первый CI PR #658 выявил
отсутствующие compound indexes и DataError в границах выборки; исправлены индексы
и запросы, добавлена регрессия пустой ветки/строкового cursor/изоляции соседней ветки.
Результат повторного CI и проверки устройств не заявляются пройденными.

Невыполненные проверки обычными авторизованными аккаунтами, только после отдельного разрешения:

1. Coach + Client одной пары: create/send/read, own edit/delete и read-state, cross-device.
2. Попытки изменить чужую строку и прочитать другую пару: серверный отказ/нет чужого subset.
   Подмена собственного owner/provenance не объявляется server-immutable.
3. Два устройства на общей синхронизированной основе: offline edit против delete,
   high/low markRead и первое создание cursor. Синхронизация в обоих порядках.
4. Private draft на одном устройстве, send на другом, затем поздние save/cancel/retry.
   Published message не должен измениться/исчезнуть и не должен дублироваться.
5. Бывшая пара, удалённый source, потеря связи, scope switch, account close/reopen.

До этого массовая активация запрещена. Неисполненные live проверки явно остаются gates.
Релевантны A-005 (гонки мутаций/устаревшие завершения) и A-010 (runtime validation).
Перед PR требуется решение владельца по процессу задачи.

## Исправления системного ревью COMM-01–05

`getDraft(threadId)` восстанавливает новейший валидный приватный черновик автора
в этой ветке/области без сохранённого UI message ID; вариант с явным ID сохранён.
Время создания черновика не является временем публикации: при первом локальном
`send` сохранённого черновика фиксируется текущее время. Повторная отправка
возвращает ту же строку с прежними ID/временем, включая поздний edit/tombstone.
Unread по-прежнему использует существующий createdAt/id watermark; отдельного
серверного порядка, очереди или SyncEngine нет.

Worker membership preflight принимает тот же точный полный парный repeat-overlay
`pendingRepeatRule`, который сохраняет защищённый discussion operator на Flex
baseline. Смешанные, дублированные и расширенные grants отклоняются; роли не
переписываются. Нового schema/ACL Apply и включения discussion opt-in нет.

Регрессии добавлены отдельно от существующих тестов: восстановление черновика,
изоляция автора/ветки, отправка ниже прежнего read watermark и retry после edit/delete,
а также совместимость и отказы ACL профилей. Реальные Coach/Client и два устройства
по-прежнему требуют отдельной приёмки.

Команда composer содержит неперсистентный флаг requireUnsentDraft: true.
Repository проверяет его в той же локальной транзакции, что и send: уже
опубликованный ID даёт DISCUSSION_DRAFT_ALREADY_PUBLISHED, отсутствующий
черновик — DISCUSSION_DRAFT_NOT_SAVED. Это предотвращает ложное подтверждение
нового текста старой публикацией после её синхронизации с другого устройства.
Обычный send без флага сохраняет прежнюю идемпотентность retry, edit и tombstone.
Новых полей синхронизированных строк, schema/ACL или серверных блокировок нет;
проверка не заменяет отдельные испытания двух offline устройств через Dexie Cloud.
