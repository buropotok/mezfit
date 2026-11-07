# COMM-07: фактическая тренировка, упражнение и подход

Issue: [#642](https://github.com/buropotok/mezfit/issues/642). Уточнение владельца
2026-11-07 заменяет устаревшее требование нескольких тем: одна сущность — один
диалог. DiscussionSheet открывается напрямую; ensureEntityThread автоматически
переиспользует детерминированный thread COMM-06. Медиа и push не входят в этап.

## Runtime и идентичность

Обе роли используют AdHocSessionScreen → WorkoutSessionCard → SessionExercise.
Этот же экран открывает CalendarSessionSheet, включая завершённую историю.
У фактической тренировки и упражнения добавлен пункт существующего LiquidPopover,
у каждой строки подхода — отдельное меню через публичный ListItem.trailingAction.
Кнопка меню не вложена в кнопку открытия FACT. Доступ к переписке не зависит от
права редактирования FACT: завершённые и read-only экраны также имеют вход.
Непрочитанные берутся из observeAnchor, выводятся существующим UnreadCount около
закрытого меню и unreadCount внутри пункта. Превью сообщений не добавлены.

AdHocWorkoutRepository.project возвращает вычисленные discussion anchors вместе
с типизированной проекцией. UI не читает IndexedDB и не строит identity из номера,
названия упражнения, catalogue ID или sourceProgramExerciseId/sourceProgramSetId.

| Объект | ID экземпляра в интерфейсе | Канонический anchor |
| --- | --- | --- |
| Выполнение из календаря | adHocSessions.id | Прежний occurrenceId, одинаковый с плановой |
| Упражнение/подход с происхождением occurrence | adHocExercises.id / adHocSets.id | Существующий alias occurrenceExerciseId/occurrenceSetId после проверки parent/realm и frozen occurrencePlan |
| Новый FACT в запланированной тренировке | Собственный execution ID | execution namespace под тем же occurrence root |
| Ad-hoc без occurrence | Собственные session/exercise/set execution IDs | session root и execution namespaces |

Occurrence child IDs — ID конкретного запланированного экземпляра, а не ID
шаблона программы. Связь alias проверяет существующий executionDiscussionAnchor;
нельзя подставлять PLAN template ID в execution-путь. Повреждённая provenance
отключает соответствующий discussion entry, не блокируя чтение исторического FACT.
Проекция ничего не записывает и не меняет schema/ACL или механизм активации.

## Возврат, перестановки и удаление

useEntityDiscussions остаётся владельцем sheet и shell Back. Дочернее меню
делегирует выбранный типизированный target карточке тренировки после закрытия
popover. WorkoutSessionCard остаётся смонтированной; свёрнутость, прокрутка и
выбранные execution IDs сохраняются. Close/Back возвращают к той же строке.
Порядок и подпись не используются для повторного поиска объекта.

Открытый диалог принадлежит карточке, а не удаляемой строке подхода. Если текущая
проекция больше не содержит exact anchor, история остаётся видимой с подписью
«Объект недоступен. История обсуждения сохранена.» под заголовком. Соседний подход с тем же новым номером не выбирается.
Account/source switch отменяет устаревшие открытия по прежнему контракту COMM-06.
Обновление завершённого FACT не сбрасывает discussion Back вместе с редакторами.
Новых history/Telegram listeners нет. Общая лента и вход из push реализуются
своими последующими этапами; COMM-07 не добавляет фиктивный deep-link transport.

## Инвентарь заметок и старого communication UX

| Поле / потребители | Смысл | Сохранение |
| --- | --- | --- |
| occurrencePlan.comment / exercises[].notes / sets[].comment, materialLinks, chatLinks | Замороженные предписания и справочные ссылки PLAN; project, snapshot/copy | Не мигрируются в сообщения; исходные данные/копирование сохранены |
| adHocSessions.comment | Рабочая заметка о тренировке; repository.comment, WorkoutSessionCard | Сохранён редактор активной тренировки; текст также читается после завершения |
| adHocExercises.notes | Рабочая техника/инструкция; project → SessionExercise | Значения и отображение сохранены |
| adHocSets.comment | Ощущения/обстоятельства FACT; saveSet → factPatch/factOf → SetEntry | Сохранены редакторы «Как прошёл подход?» и сохранение FACT |
| SetEntryChatButton без callback | Отключённый старый Telegram shortcut без данных | Убран из текущего execution UX; переписка открывается через меню сущности |
| Legacy callback SetEntryChatButton | Явный callback старого SetEntry API | Существующий вызывающий контракт сохранён; текущие Coach/Client execution экраны его не передают |

Ни одно существующее поле заметок не доказано как отдельная история сообщений:
нет безопасного основания публиковать его в shared thread. Данные не удаляются,
не очищаются и не мигрируются; сообщения создаются только через DiscussionRepository.
Из старого теста удалено только ожидание отключённого Telegram shortcut, как
явно упразднённого communication UX. Остальные бизнес-инварианты не ослаблены.

## Проверки и границы доказательств

Добавлены source-тесты реальных IndexedDB проекций Coach/Client, одинакового
scheduled anchor/thread ID, собственных execution ID, перестановки/tombstone,
повреждённого origin и неизменности PLAN/FACT. Компонентные сценарии проверяют
три меню, повторное открытие, единственный sheet, непрочитанные, Back, сохранение
раскрытого упражнения и unavailable при удалении. Существующие COMM-06 тесты
проверяют автоматическое создание/конкурентное открытие и account/source switch.

Локальные npm/typecheck/test/build не запускаются: их выполняет CI после PR.
Эта запись не означает успешный CI или приёмку на настоящих iOS/Android и двух
offline устройствах. Физически проверить Coach ↔ Client, календарь → completed,
два одинаковых упражнения, чтение/ответ, закрытие sheet и offline/reconnect.

При pre-PR ревью релевантны A-003 (единый Back), A-005/A-013 (async ownership),
A-008/A-012 (UIkit composition) и A-010 (identity/realm/provenance). Отдельного
cloud Apply, feature flag, media upload или push в этом этапе нет.
