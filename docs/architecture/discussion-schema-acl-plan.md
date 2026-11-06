# COMM-03: DiscussionAnchor, схема и полный ACL MVP

Дата: 2026-11-06. Корректировка после merge PR #653, основа main: `f7688ba4`.
Задача: [#638](https://github.com/buropotok/mezfit/issues/638).
**Статус:** владелец отдельно одобрил подготовку узкого protected operator и
обычную owner-модель MVP и её расширение на вложения. Это не разрешение live Apply.
В рамках подготовки cloud не менялся; состояние production подтверждается отдельным Preview.

## Решения и границы

Telegram identity `tg:...` и существующий realm пары сохраняются.
`coachClientId` — identity канонического relationship realm, отдельного справочника нет.
Ни новый backend сообщений, ни SyncEngine, ни ACL-дерево на каждую сущность не создаются.
Этот PR не реализует UI, CRUD сообщений, media gateway/URLs, кеш/загрузки и retention.
Последующие репозитории используют подготовленные типы и обычный Addon.

Владелец принял простой вариант: native Dexie owner защищает чужие строки при отсутствии
общих update/manage grants. Собственный автор/thread/realm сохраняются доменным
репозиторием при штатных операциях; строгой серверной неизменяемости этих полей у
владельца строки нет. Это явное исключение для discussion message/read-state/attachment в AGENTS,
а не изменение защиты PLAN/FACT или привилегий других таблиц.

Официальный [Dexie access control](https://dexie.org/docs/cloud/access-control):
owner имеет полные права на свою запись, независимо от полевого allowlist роли.
[DBPermissionSet](https://dexie.org/docs/cloud/DBPermissionSet) не выражает predicate
`authorUserId == currentUser` для ownerless сообщений. Поэтому для MVP не добавлены
backend CRUD, per-author/per-message realms или дополнительные серверные механизмы.

## Идентичности и реальные источники

`shared/discussion-anchor.ts` — discriminated union из четырёх уровней, canonical key,
parent path, runtime shape guard и автоназвание «имя сущности · дата».
`src/data/cloud/discussion-anchors.ts` — чистые адаптеры реальных строк:

| Уровень / источник | Каноническая идентичность |
| --- | --- |
| Программа целиком | trainingPlanId; фазы/дни/элементы шаблона запрещены |
| Запланированная workout и её execution | occurrence ID; session.occurrenceId ведёт к тому же корню |
| Exercise/set occurrence и execution | occurrenceExerciseId / occurrenceSetId при доказанном наличии во frozen occurrencePlan |
| Новый FACT внутри planned execution | execution ID конкретного элемента под тем же occurrence root, без угадывания по position |
| Ad-hoc без occurrence | session ID + execution instance ID |
| Legacy session PLAN/FACT | отдельный legacy-session root; legacy и legacy-fact instance namespaces различаются |

Ключ — сериализованный фиксированный массив realm/отношения/namespace/ID; порядок полей
объекта, названия, position и catalogue exerciseDefinitionId его не меняют. Поэтому
две session-проекции и два устройства не создают другой контекст для одной occurrence.
Две разные пары/личная область не сливаются при одинаковом source ID.

Отдельной таблицы реестра/alias для MVP нет: существующие provenance fields уже дают
соответствие, anchor и contextPath хранятся внутри thread. Несколько независимых веток
у одного ключа разрешены. Если origin ID не доказан реальными parent/snapshot связями,
адаптер отклоняет запрос. Для удалённого источника сохранённый anchor/snapshot остаётся
пригоден для истории; отсутствие объекта не повод направлять к соседнему подходу.
Legacy не перепривязывается к occurrence через program ID или номер подхода.

## Таблицы, локальная схема и безопасное включение

`discussion-contracts.ts` содержит типы и доменные write guards, без persistent CRUD.

| Таблица | Cloud primary key | Локальные индексы |
| --- | --- | --- |
| discussionThreads | id | realmId, [realmId+coachClientId], [realmId+anchorKey], [realmId+lastActivityAt] |
| discussionMessages | id | realmId, [realmId+threadId], [realmId+threadId+createdAt], [realmId+authorUserId] |
| discussionReadStates | id | realmId, [realmId+threadId+userId] |
| messageAttachments | id | realmId, [realmId+messageId] |

Thread содержит anchor/contextPath/anchorKey, derivedTitleSnapshot и timestamps,
`owner: realmId` (не пользователь); общая правка — только lastActivityAt.
Message содержит owner=authorUserId, thread, text, replyToMessageId и timestamps
edit/delete. Reply только в том же thread/realm; удалённый оригинал допускает placeholder.
Normal edit не меняет автора/контекст; normal delete оставляет пустой текст с deletedAt,
не сохраняет историю редакций и не восстанавливает удалённое сообщение случайной правкой.
Read-state owner=userId; детерминированный ID realm/thread/user один на устройствах
участника. Guard проверяет принадлежность последнего прочитанного сообщения этой ветке.
Это контракт будущего repository, не уже реализованная синхронизация read cursor.

Нет open/resolved/requiresReply, реакций, пересылок, специальных чат-ролей.
Attachment содержит owner=authorUserId и messageId в том же realm. Для photo/video/voice
подготовлены только метаданные и write guards, не загрузчик. Обе роли могут добавлять
собственные вложения; общих update/manage для чужих вложений нет. Срок хранения
реализует COMM-13; удаление автором оставляет deletedAt, физические файлы удаляет шлюз.

Подготовлена append-only `CLOUD_DATABASE_STORES_V15`, не меняющая v14. Важная граница:
[sealed cloud schema](https://dexie.org/docs/cloud/cli) требует server import до того,
как клиент объявит новые sync-таблицы. Поэтому существующий production factory по
умолчанию остаётся v14. Только явный `{ discussions: true }` в constructor/factory
регистрирует v15 в **том же account-scoped IndexedDB**, не в отдельной БД.
После одобренного cloud Apply и live проверки следующий integration PR включает это
для всего lifecycle аккаунта. После использования v15 не возвращаться к клиенту v14:
это schema downgrade, а не способ выключить UI. Никаких unsynced chat tables или
устройственного shadow-хранилища до активации нет. В этом PR опция нигде не включается.

## Минимальные серверные grants и совместимость

`cloud/discussion-roles.json` добавляет обеим существующим ролям только:

```json
{
  "add": ["discussionThreads", "discussionMessages", "discussionReadStates", "messageAttachments"],
  "update": { "discussionThreads": ["lastActivityAt"] }
}
```

Чтение — по прежней membership пары. Нет общих update/manage для messages/read-state/attachments:
чужую строку такой участник не редактирует, собственную — редактирует как owner.
Ни знание anchor ID, ни membership другой пары не дают доступ к этой истории.
Row ownership может менять сам owner; это одобренное MVP ограничение, не новая гарантия.
Правила доступа к Yandex объекту не выводятся из storageKey и вне scope этого PR.

Worker membership preflight принимает прежние profiles и точную новую надстройку на
Flex baseline, полный текстовый профиль PR #653 и полный профиль MVP с вложениями.
`discussionRolesBaseline` снимает только проверенный полный overlay,
после чего неизменённый базовый verifier проверяет остальные grants. Половинные,
дублирующиеся и расширенные policies отклоняются; новых actor/member IDs не появляется.
Без этой совместимости новые глобальные grants сломали бы приём приглашений.

## Отдельный protected operator

Подготовлены `tools/dexie-roles/discussions.mjs` и `.github/workflows/dexie-discussions.yml`.
Действующий Flex/operator и другие установщики не расширены.

- Только additive `cloud/schema-discussions.json`: четыре таблицы с ключом id.
- Только точный overlay coach/client на **полном EXPECTED_FLEX_ROLES baseline** либо
  полном текстовом профиле PR #653 либо точном полном MVP target. Профили Coach/Client
  нельзя смешивать. Для каждого профиля также допускается точный полный
  `pendingRepeatRule` overlay обеих ролей, уже установленный календарным оператором.
  Незнакомую/частичную policy не чинить
  автоматически; Preview откажет, потребуется отдельное ревью фактической конфигурации.
- Другие роли, все чужие schema entries, owner/realm, PLAN/FACT, membership и бизнес-данные
  сохраняются. Нет новых credentials/чат-ролей, общих attachment update/manage или DELETE grants.
- Owner/main/manual workflow_dispatch, environment dexie-production с reviewers,
  существующий DEXIE_CLOUD_WRITE_KEY и общий privileged writer concurrency.
- Preview не импортирует. Apply требует отдельного решения владельца, отметки
  `comm02_validated=true` и literal `APPLY_DISCUSSIONS_SCHEMA_AND_ACL`.
  Эта отметка — свидетельство владельца, не автоматическая проверка телефонов.
- Полный schema/roles export до операции, точный recheck непосредственно перед импортом,
  readback после попытки импорта (в том числе CLI error) и при no-op; cleanup в always.
  Ошибка/частичный результат не считается успехом. Старые операторы могут отказать
  на расширенном baseline — не ослаблять их allowlists ради отката.

Порядок: review/CI/merge не включает опцию v15 → отдельное согласие live Apply после
COMM-02 → protected Preview/Apply и full readback → обычные аккаунты/live ACL →
явное включение v15 в integration PR. Нельзя выдавать static readback за live permission test.
Реальные cloud writes в рамках подготовки/PR не выполнялись.

## Вложения: контракт всего MVP (корректировка после #653)

`shared/discussion-attachment.ts` — общий тип для будущего gateway и приложения;
`discussion-contracts.ts` переэкспортирует его. Новых индексов/таблиц нет, schema v15
и её opt-in не меняются; поля метаданных не требуют новой версии IndexedDB/ACL.
Проверены требования COMM-09 #644, COMM-10 #645 и COMM-11 #646. Их расширенные
загрузчики/инфраструктура не входят в корректировку.

| Операция | Право/контракт |
| --- | --- |
| Создать photo/video/voice | обе роли add messageAttachments; owner=authorUserId=actor |
| Обновить собственный ход загрузки/метаданные | native owner; без shared update/manage |
| Читать сообщение/вложение | существующая membership соответствующего realm, в том числе бывшая пара |
| Удалить собственное вложение | native owner; штатный repository использует deletedAt, шлюз удаляет файл отдельно |
| Изменить чужое вложение | ни одного нового общего grant |
| PLAN/FACT, роли/чужая пара, новые credentials | ни одного изменения/разрешения |

Состояния: `pending` → `uploading` → `ready`; ошибка → `failed` → повтор на том же ID.
Отмена/удаление — tombstone `deletedAt`, отменённый объект не подтверждается вновь.
Один attachmentId обозначает один файл: mediaType/MIME/size/duration/message/realm/author
не заменяются при retry; storageKey после назначения стабилен. Выбор другого файла
создаёт новое вложение явным действием. Фото duration=null; видео >0 и ≤180 секунд;
голос >0; MIME соответствует выбранному типу, универсальный codec не навязывается.
Фактическую проверку содержимого и формата делает COMM-09, не эти shape guards.

Простой confirm без второй БД/очереди/новых grants:

1. Будущий шлюз связывает upload intent с attachmentId/messageId/realm/author и стабильным
   storageKey. Он самостоятельно проверяет Telegram identity, membership и доступ
   к сообщению, не превращает supplied IDs в разрешение и не требует раннего sync
   метаданных как бизнес-барьера; протокол доказательства realm — задача COMM-09.
2. После PUT клиент запрашивает confirm. Шлюз проверяет объект (HEAD/реальный размер,
   MIME/контент/длительность, соответствие intent; ETag/identity по API storage).
   При отсутствии/несоответствии объекта успех не возвращается.
3. Ответ `AttachmentUploadConfirmation`: attachmentId, messageId, realmId, authorUserId,
   mediaType, storageKey, mimeType, sizeBytes, durationSeconds, confirmedAt (ISO).
   Это ответ аутентифицированного endpoint, не статический bearer URL и не новый grant.
   `applyAttachmentUploadConfirmation` декодирует unknown и сверяет все идентичности
   и file metadata; normal repository применяет результат к прежней строке и синхронизирует
   через Addon. Повтор confirm сохраняет первый confirmedAt, сообщение/вложение не копируются.
4. `ready`/confirmedAt в пользовательской Dexie-строке **не доказательство для сервера**:
   owner может изменить все её поля. Шлюз проверяет доступ/наличие/идентичность файла
   независимо при confirm/read/remove, а не доверяет флагу или знанию storageKey.
   Уведомление/доставка не должны объявлять файл готовым лишь по клиентскому флагу.

Сохранённые данные со старой формой MessageAttachment без uploadState/author/confirmedAt
нельзя объявлять ready автоматически. Производственного attachment writer в #653 нет;
если Preview/инвентаризация обнаружат такие строки, COMM-09 валидирует их через gateway
до использования и сохраняет исходные ID. Массового удаления/перезаписи данных здесь нет.
Native owner не обеспечивает серверные foreign keys, immutable provenance или
полевое ограничение владельца; guards — нормальный доменный контракт, не ACL эмулятор.

## Проверка установленного профиля и совместимый rollout

При подготовке 2026-11-06 GitHub Actions API для `dexie-discussions.yml` вернул
`total_count: 0`. Запусков не обнаружено, но ручной импорт вне GitHub не исключён.
Серверный schema/roles export не выполнялся: protected credentials не извлекались,
Preview/Apply не запускались. Не утверждать, что production пустой или уже готов.

Один Apply принимает только полные точные состояния обеих ролей:

| Экспорт до Apply | План |
| --- | --- |
| Полный Flex, таблиц ещё нет | добавить четыре таблицы и полный MVP overlay |
| Четыре таблицы id уже есть, точный текстовый профиль PR #653 | не менять schema, добавить только attachment add обеим ролям |
| Полный MVP профиль и четыре таблицы | no-op с полным readback |
| Неожиданные grants/ключи или смешанные/частичные роли | отказ; показать drift владельцу, без автоматического исправления |

Preview обязан экспортировать фактическую schema/roles и показать sourceProfile, затем
отдельное одобрение live Apply. Перед импортом — повторный полный export/recheck; после
любой попытки и no-op — readback всей конфигурации, включая посторонние роли и таблицы.
Не откатывать установленные таблицы, не переписывать старые Dexie версии или business rows.

Дополнительные тесты проверяют точные manifests/profiles, узкую дельту с PR #653,
отказ mixed/duplicate/widened grants, shape/parent/own write guards и idempotent confirm.
Fake IndexedDB с настоящим pinned Addon проверяет одну строку при retry/confirm/reopen
и realm/message index. Ни эти тесты, ни readback **не являются live ACL проверкой**.

Перед включением функции требуется реальная матрица обычных аккаунтов (пока не выполнена):

| Сценарий | Ожидаемый серверный результат |
| --- | --- |
| Coach и Client создают свои photo/video/voice metadata | sync принят в их realm |
| Каждый обновляет/удаляет свою строку | разрешено native owner |
| Каждый меняет/удаляет чужую строку | отказ, общих update/manage нет |
| Второй тренер запрашивает attachment/message другой пары | запись не синхронизируется/чтение запрещено |
| Owner меняет собственный author/parent | не заявлять запрет сервера; штатный repository отклоняет |
| Два устройства retry/confirm, бывшая пара | тот же ID, без дублей; история своей пары остаётся доступной |
| Text/Reply/Edit/Delete/read-state | прежние возможности и ограничения сохранены |


## Завершение отношений и бывшие участники

`relationshipMembership` создаёт ownerless realm и две ownerless accepted membership
с существующими ролями. `checkApprovedAssignedPair` требует этот канонический realm,
ровно двух участников своей пары и точные роли. Нет отдельной cloud-модели endedAt;
legacy D1 status не является источником membership. В просмотренных runtime-путях
не обнаружена операция завершения сотрудничества, удаляющая membership. Это source
review, не live audit и не свидетельство уже реализованного lifecycle окончания.

Уточнение владельца: бывшие участники читают прежнюю общую историю, пока она хранится;
медиа — 6 календарных месяцев после окончания, текст без автоудаления. Подключение
нового тренера этого не меняет. Нельзя удалять membership только из-за окончания
сопровождения. Новый endpoint или перевод бывших участников на read-only сейчас не
добавляется: он затронул бы точные roles других доменов и требует отдельного решения.

## Проверки и приёмка

Добавлены contract/unit тесты canonical IDs/parents, occurrence→execution, legacy FACT,
изменения порядка/логического удаления, двух тренеров и личной истории; normal own
edit/delete, reply same-thread и read-state двух устройств. Fake IndexedDB upgrade
сохраняет v14 данные; compound realm indexes не смешивают записи разных пар.
Operator tests проверяют manifest/baseline, drift/no-op/failed readback и dispatch.
Membership preflight tests проверяют прежний/новый profile и частичные/escalated grants.

Эти тесты не являются запросами к реальному Dexie Cloud и не доказывают серверные ACL
обычных аккаунтов. Перед live activation: два тренера + один клиент, своё/чужое
edit/delete/read-state, другая пара, два устройства, бывшие участники, удалённый источник;
подмена owner/realm проверяется в пределах согласованной native owner модели.

По workflow проекта локальные npm/typecheck/tests/build не запускаются; CI — после PR.
После коммита выполнено системное ревью схемы/ACL, shared guards, membership preflight,
protected workflow и исходников связанных тестов. Старые проверки Text/Reply/Edit/Delete/
read-state и v14→v15 оставлены; изменена только устаревшая schema-only проверка grants.
Проверены синтаксис JSON/YAML/.mjs, локальные ссылки документации и git diff --check.
Это не запуск npm/typecheck/tests/build; они выполняются CI после PR.

Релевантен audit **A-010** (runtime API данные без достаточного декодирования):
изменяемый decoder ролей сохраняет строгий baseline; будущий ответ gateway принимается
как unknown с проверкой shape и привязки, не приводится к доверенному типу через cast.
Фактор сообщён владельцу до разрешения корректировки. Production права и live проверки
отдельны от этого source review и не объявляются выполненными.

## Коррекция Discussions Preview: сохранение установленного ACL повторений

Исследован [упавший Preview 42247353001](https://github.com/buropotok/mezfit/actions/runs/42247353001):
экспорт schema/roles прошёл, затем `UNEXPECTED_DISCUSSION_ROLE_BASELINE`; импорт не
запускался. После cleanup exports удалены, API artifacts вернул пустой список.
Точный полный export **этого** запуска недоступен; отсутствие других отличий от
baseline не заявляется. Следующий защищённый Preview должен подтвердить профиль
или показать остальные расхождения, прежде чем владелец разрешит Apply.

История защищённых операций подтверждает законное изменение после Flex:

| Запуск | Подтверждение в логах |
| --- | --- |
| [40980110480, 2026-10-30](https://github.com/buropotok/mezfit/actions/runs/40980110480) | Flex Apply, расширены Coach/Client, import complete, полный readback verified |
| [41836076736, 2026-11-04](https://github.com/buropotok/mezfit/actions/runs/41836076736) | Calendar repetition Apply: изменены обе роли, import complete, полный readback verified |

`calendar-repeat.mjs` и `cloud/calendar-repeat-roles.json` на commit `44cfb9ec`
устанавливают только `permissions.update.workoutOccurrences += pendingRepeatRule`.
Эти файлы, Flex/coached-start operator и cloud/roles.json между тем commit и основой
корректировки `d3398253` не изменились. Старые три discussion profiles не включали
это подтверждённое permission. Ошибка оператора не означает ошибочные production роли.
Известное расхождение не заменяет проверку свежего серверного экспорта.

Поддержаны прежние три полных профиля и те же три с точным полным repeat overlay.
Оба участника должны иметь одинаковый профиль; половинные/mixed policies не принимаются.
Оператор **не добавляет** pendingRepeatRule при его отсутствии. После валидации
копируется живая строка роли и дописываются только отсутствующие discussion grants;
сохраняются прежние PLAN/FACT/calendar grants, role metadata и порядок массивов.
Manifest обсуждений и четыре таблицы не изменены. Runtime membership verifier и
прочие ACL операторы этим исправлением не меняются; это не исправление отдельного
предсуществующего ограничения приглашений при новых календарных permissions.

Порядок несемантичен только у permission sets `add`, `manage` и массивов полей `update`.
Они сравниваются как уникальные string sets; повторяющиеся элементы и неверные типы
отклоняются. Прочие поля/массивы не нормализуются. Recheck и full readback сохраняют
эту семантику для Coach/Client, но проверяют все прежние роли, schema и metadata;
неожиданные дополнительные права/потеря repeat или изменение сторонней роли — отказ.

При отказе выводится JSON diagnostic только для Coach/Client: сравнение с Flex,
распознанные профили, пути permissions, installedOnly/missing/duplicates. Существующее
pendingRepeatRule отмечается `approved-existing:calendar-repeat`; grants обсуждений —
`approved-discussion`; остальные расширения — `unknown-or-unapproved`. Метка approved
не разрешает смешанный профиль. Известные имена таблиц/полей берутся из кода разрешённых
профилей; reserved owner/realm/author ID поля можно назвать как опасные additions.
Произвольные неизвестные идентификаторы редактируются, метаданные ролей/значения,
секреты и membership/user/message records вообще не сериализуются в отчёт.
Если metadata роли отличается, она не принимается молча: перечисляются только известные
имена изменённых metadata keys (например displayName), их значения не печатаются.

Добавлены регрессионные тесты полного Flex+repeat, сохранности всех прежних grants,
semantic order/duplicates, unknown/mixed policies, diagnostics и full readback.
CLI fixture вызывает только локальный operator plan в CI на несекретных искусственных
exports: проверяет отказ, диагностический stderr, неизменность before files и отсутствие
import payload на ошибке. Никаких production вызовов/credentials в тестах нет.
Старые тесты сохранены. Локальные npm/typecheck/build/tests не запускались.

Audit **A-010** релевантен проверке недоверенного cloud role export: сохранены точные
профили и отказ на неизвестных данных, добавлен безопасный diagnostic. Перед открытием
корректирующего PR требуется решение владельца согласно процессу задачи.
