# COMM-03: DiscussionAnchor, схема и минимальные ACL

Дата: 2026-11-06. Основа main: `30f2d4ef`.
Задача: [#638](https://github.com/buropotok/mezfit/issues/638).
**Статус:** владелец отдельно одобрил подготовку узкого protected operator и
обычную owner-модель MVP. Это не разрешение live Apply. Таблицы/роли в cloud не менялись.

## Решения и границы

Telegram identity `tg:...` и существующий realm пары сохраняются.
`coachClientId` — identity канонического relationship realm, отдельного справочника нет.
Ни новый backend сообщений, ни SyncEngine, ни ACL-дерево на каждую сущность не создаются.
Этот PR не реализует UI, CRUD сообщений, media gateway/URLs, кеш/загрузки и retention.
Последующие репозитории используют подготовленные типы и обычный Addon.

Владелец принял простой вариант: native Dexie owner защищает чужие строки при отсутствии
общих update/manage grants. Собственный автор/thread/realm сохраняются доменным
репозиторием при штатных операциях; строгой серверной неизменяемости этих полей у
владельца строки нет. Это явное исключение для discussion message/read-state в AGENTS,
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
Attachment пока только тип метаданных photo/video/voice и таблица. Широкие shared-realm
write grants для него не выдаются. Срок хранения реализует COMM-13.

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
  "add": ["discussionThreads", "discussionMessages", "discussionReadStates"],
  "update": { "discussionThreads": ["lastActivityAt"] }
}
```

Чтение — по прежней membership пары. Нет общих update/manage для messages/read-state:
чужую строку такой участник не редактирует, собственную — редактирует как owner.
Ни знание anchor ID, ни membership другой пары не дают доступ к этой истории.
Row ownership может менять сам owner; это одобренное MVP ограничение, не новая гарантия.
Правила доступа к Yandex объекту не выводятся из storageKey и вне scope этого PR.

Worker membership preflight принимает прежние profiles и точную новую надстройку на
Flex baseline. `discussionRolesBaseline` снимает только проверенный полный overlay,
после чего неизменённый базовый verifier проверяет остальные grants. Половинные,
дублирующиеся и расширенные policies отклоняются; новых actor/member IDs не появляется.
Без этой совместимости новые глобальные grants сломали бы приём приглашений.

## Отдельный protected operator

Подготовлены `tools/dexie-roles/discussions.mjs` и `.github/workflows/dexie-discussions.yml`.
Действующий Flex/operator и другие установщики не расширены.

- Только additive `cloud/schema-discussions.json`: четыре таблицы с ключом id.
- Только точный overlay coach/client на **полном EXPECTED_FLEX_ROLES baseline** либо
  его точном уже применённом discussion target. Незнакомую/частичную policy не чинить
  автоматически; Preview откажет, потребуется отдельное ревью фактической конфигурации.
- Другие роли, все чужие schema entries, owner/realm, PLAN/FACT, membership и бизнес-данные
  сохраняются. Нет новых credentials/чат-ролей, обычных attachment write grants или DELETE grants.
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
После коммита выполнено системное ревью по issue/AGENTS/архитектуре и исходникам новых и связанных прежних тестов. Старые тесты не менялись. Исправлены оставшиеся формулировки документации о реестре, уточнено название workflow шага для обеих ролей и добавлен отрицательный случай третьего участника в том же realm; повторное ревью обязательно перед публикацией. Фактор audit
A-010 (непроверенные runtime HTTP данные) релевантен membership response validation:
новый decoder узко проверяет overlay и сохраняет строгую проверку baseline.
