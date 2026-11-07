# COMM-06: программа и запланированная тренировка

Issue: [#641](https://github.com/buropotok/mezfit/issues/641).

## Владение и границы

`CloudProgramDetailsPage` обеих ролей показывает отдельную круглую `message-circle`
размером с аватар непосредственно под аватаром владельца в `ProgramSummary`.
У кнопки есть unread. `CloudProgramsPage.ProgramRow` добавляет «Обсуждения» в
существующее меню, сохраняя прежние действия. У Client assigned PLAN доступен
только discussion-пункт; личные программы сохраняют обычные действия.
Оба пути используют `programDiscussionTarget` и один canonical thread.

`OccurrenceDraftEditor` использует `plannedDiscussionTarget`: только канонический
occurrence ID, в том числе после Start/completion. Существующий execution alias
ссылается на тот же anchor. У фазы/дня/упражнения/подхода шаблона входов нет.
Start, provenance, PLAN/FACT и membership не меняются.

`useEntityDiscussions` владеет overlay над смонтированным источником и создаёт
scoped `DiscussionRepository` на account-owned db. По нажатию сразу открывается
sheet; `ensureEntityThread` автоматически получает постоянный ID
`entity-discussion:` + SHA-256 от `discussionAnchorKey(scope, anchor)`.
Дата, имя и actor в ID не входят. Локальная транзакция возвращает существующую
строку либо добавляет её. Два offline устройства получают тот же primary key;
Addon владеет слиянием и репликацией, cloud CRUD и нового SyncEngine нет.

Старые threads остаются на месте. Канонический вход читает страницы по всем
валидным thread IDs точного anchor/пары, сортирует по createdAt/id. Сообщения
не копируются, attachment keys и reply IDs сохраняются. Новые ответы могут
ссылаться на старую историю; собственные edit/delete меняют исходные строки.
Старые низкоуровневые thread APIs остаются для чтения legacy targets и совместимости;
UI больше не вызывает случайный createThread. Unread суммируется по исходным
read-state без отдельного persistent счётчика. История соседних realm/anchor исключена.

Back и Close возвращают напрямую к исходному экрану через текущий NavigationShell.
Промежуточного списка, «Создать обсуждение», дублирующей капсулы и новых
history/Telegram listeners нет. Сохраняются source scrollKey/contentMode,
фильтры и состояние редактора. Account/source switch и unmount отменяют
устаревший UI completion, не принятую локальную запись.

markRead выполняется при видимой переписке у конца либо при просмотре старых
сообщений. Для объединённой истории продвигается отдельный watermark каждого
исходного thread до просмотренного cursor. Собственная отметка не подтверждает
прочтение собеседником. Вторая галочка требует реплицированного recipient
read-state соответствующего storage thread. Общий sync status её не подменяет.
Строки без readThrough валидируются по существующему lastReadMessageId и
продвигаются без сброса истории; повреждённые cursor не считаются подтверждением.
Ошибка отметки видна и допускает retry. Telegram-подобные inline галочки сохранены.

## Инвентарь legacy-полей до изменения UX

| Поле / поверхность | Потребители и классификация | Решение COMM-06 |
| --- | --- | --- |
| Корневая программа | CloudTrainingPlanRow не имеет comment/notes; ProgramSummary показывает участников и sync | Второго редактора переписки нет; добавлен только root menu |
| programDays.comment | ProgramPhaseDays → ProgramDayDialog → ProgramManagementRepository.commentDay; snapshotProgramDay и copy | Рабочее предписание PLAN; сохранить редактор, значения и копирование. Не превращать в сообщения |
| programExercises.notes / occurrence.plan.exercises[].notes | ProgramManagementRepository, WorkoutPlanCard, snapshot/copy, frozen execution PLAN | Инструкция/техника PLAN; сохранить данные и приватность |
| programSets.comment / occurrence.plan.exercises[].sets[].comment, materialLinks, chatLinks | Шаблонные предписания и ссылки; snapshot/copy, SetEntry PLAN | Сохранить бизнес-данные без автоматической публикации в обсуждения |
| occurrence.plan.comment | Snapshot дня, WorkoutPlanCard read-only text, копирование | Предписание PLAN. OccurrenceDraftEditor уже передаёт hideWorkoutActions; отдельный коммуникационный редактор недоступен |
| session/execution comment, exercise notes, set FACT comment | Выполненные тренировки и ощущения; ветвь !isPlan в SetEntryOccurrenceMetrics | Вне COMM-06; не менять FACT или его пользовательские редакторы |

Имена полей сами по себе не доказывают коммуникационный смысл. Бизнес-инварианты
подтверждаются исходниками `workout-occurrence-edit.test.ts`, `workout-copy.test.ts`
и `SessionExercise.program.test.tsx`. В этом PR нет удаления, миграции, переименования
полей или раскрытия личных заметок. Текст/вложения новой переписки идут только
через discussion-вход. Неоднозначную историю не переносим в shared realm.

## Поставка и проверки

Обычный merge/deploy включает регистрацию v15/v16 и локального индекса v17 таблиц и индексов
на всём account lifecycle. Нет новых flags, env, workflows, Apply или ручной
активации. Cloud schema/grants остаются установленными COMM-03. Возвращать
обновлённый IndexedDB к v14 нельзя; старые schema fixtures остаются явными тестами.

Код тестов проверяется до PR; npm/typecheck/test/build выполняет GitHub Actions
после открытия PR. Добавлены сценарии повторного/конкурентного открытия,
совместимости legacy pagination/replies/edit/delete, обоих направлений read-state,
изоляции пары, Back, source/account switch и retry. Локальные IndexedDB-тесты
не являются проверкой двух настоящих offline устройств или production ACL.

Физическая приёмка: Coach → Client и Client → Coach; при видимом sheet одна
галочка меняется на две на устройстве отправителя; закрытие/повторное открытие;
два устройства одновременно создают пустой чат; offline send/read и reconnect
в обоих порядках; старая многоветочная история сохраняется; Back возвращает
к программе/occurrence с прежним состоянием. Эти live проверки здесь не выполнены.

При ревью учитываются A-003 (единый Back), A-005/A-013 (устаревшие async completion),
A-008/A-012 (публичные UIkit APIs) и A-010 (валидация cached identity/realm).

Уточнение индексов COMM-06: локальная v17 добавляет только `[id+lastReadAt]`
для условного обновления legacy read-state. Таблицы/поля/cloud ACL не меняются;
upgrade выполняется при обычном открытии account DB.
