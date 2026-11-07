# COMM-06: программа и запланированная тренировка

Issue: [#641](https://github.com/buropotok/mezfit/issues/641).

## Владение и границы

`CloudProgramDetailsPage` обеих ролей предоставляет меню корневой программы →
«Обсуждения». У фазы, дня, упражнения и подхода шаблона discussion-входов нет.
`OccurrenceDraftEditor` добавляет этот пункт в существующее меню календарной
плановой тренировки, включая read-only PLAN клиента и inline planned card.
После появления execution этот PR не добавляет входы: они относятся к COMM-07.
Occurrence ID берётся из существующей проекции, а не из source program/day ID.
`programDiscussionAnchor` и `occurrenceDiscussionAnchor` остаются единственными
адаптерами; существующий execution alias использует тот же occurrence ID.
Start, owner, provenance, PLAN/FACT и membership не меняются.

`useEntityDiscussions` создаёт scoped DiscussionRepository на существующем
account-owned db. Repository проверяет прежнюю membership пары; UI не выдаёт
прав и не делает HTTP CRUD. Один observeAnchor даёт список, entity unread и
unread по каждой ветке. Нет last-message preview, thumbnails или статусов.
Новый create использует имя сущности и текущую локальную дату, повтор — тот же
ID. Закрытие/смена аккаунта/источника отменяют UI completion и subscriptions,
не отменяя уже принятую локальную запись.

Список и существующий DiscussionSheet — overlay над смонтированным источником.
NavigationShell предоставляет read-only snapshot текущего контекста; overlay
сохраняет его scrollKey и contentMode. Back в чате сначала использует его
прежние nested действия, затем возвращает к списку; Back списка, Close и ссылка
на контекст возвращают к исходному экрану. Новых history/Telegram listeners нет.
Фильтры, выбранная программа/occurrence и состояние редактора не переписываются.
Title snapshot ветки остаётся историческим. Удаление программы во время чтения
не перенаправляет к другой программе: открытая история сохраняется, создание
новых веток отключается, исходный экран честно показывает отсутствие объекта.

LiquidPopover получает публичный optional unreadCount, отображаемый Caption
superscript и в browser-measured canvas handoff. Feature CSS не обращается к
Konsta DOM или private selectors. Konsta 5.4.0 и адаптеры не меняются.

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

## Активация и проверка

Общий build-time gate: `VITE_CLOUD_DISCUSSIONS_ENABLED=true`. Он применяется
в constructor/factory для всего account lifecycle, а не при открытии одного
sheet. Без gate сохраняется v14, пункт не выполняет записи. Новых схем, grants,
operator Apply и инфраструктурных ресурсов здесь нет. После upgrade нельзя
выключать регистрацию v16 для того же IndexedDB или возвращать старый клиент.
Gate включать только после одобренного Apply и реальных ordinary-account ACL
проверок из COMM-03/04. Наличие этого PR не подтверждает их прохождение.

Добавлены проверки targets, общего overlay, retry/late completion, source deletion,
изоляции разных тренеров/personal history и repository unread. Старые тесты не
изменяются. Локальные npm/typecheck/test/build запрещены issue и не запускались;
их выполняет CI после PR. Физические Telegram Android/iOS, offline двух устройств
и серверные Coach/Client ACL остаются отдельной приёмкой.

Релевантные факторы audit/2026-09-16_application_audit.md: A-003 — единый Back и
сохранение навигации; A-005 — устаревшие async completion; A-008 — публичные UI API;
A-009 — retry ошибки. Эти факторы учтены в реализации и новых тестах; по процессу
issue перед открытием PR необходимо решение владельца.
