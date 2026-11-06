# COMM-03: план схемы и границы одобрения

Дата: 2026-11-06. Основа: main `30f2d4ef`.
Задача: [#638](https://github.com/buropotok/mezfit/issues/638).
Статус: **предварительная проверка выполнена; реализация остановлена до решений ниже**.
Это не установленная схема, не оператор применения и не доказательство server permissions.

## Принятые простые решения

- Telegram identity `tg:...` и существующий realm конкретной пары сохраняются.
  В действующей модели `coachClientId` — identity того же канонического relationship realm.
- Четыре уровня anchor: trainingPlan целиком, конкретная workout, exercise и set
  внутри workout. Нет anchors у элементов шаблона и нет отдельных ACL для anchors.
- Для planned/execution корень — occurrence ID. Session `occurrenceId`, exercise
  `occurrenceExerciseId` и set `occurrenceSetId` связывают экземпляры по фактическим
  immutable provenance полям; position и exerciseDefinitionId не используются как ID.
- Для ad-hoc без occurrence корень — session ID. Новые FACT-экземпляры без occurrence
  provenance нельзя угадывать по позиции: нужна собственная namespace execution ID.
- Историю бывшие участники продолжают читать; новая пара её не наследует. Срок медиа
  — 6 календарных месяцев после окончания отношений, текст без автоматического удаления.

## Конкретный объём предлагаемого protected operator

Подготовку нового потребителя защищённой учётной записи нужно отдельно разрешить:
действующий AGENTS §21 содержит закрытый список целей; обсуждения туда не входят.
Предлагаемые пути после согласия:

- `cloud/schema-discussions.json` — только additive schema четырёх таблиц ниже.
- `cloud/discussion-roles.json` — точный additive overlay существующих coach/client,
  без новых чат-ролей и без grant-дерева для exercise/set.
- `tools/dexie-roles/discussions.mjs` и `.github/workflows/dexie-discussions.yml` —
  отдельные Preview/Apply, ручной owner/main dispatch, environment `dexie-production`
  с required reviewers, существующий общий writer concurrency, literal confirmation,
  полный recheck перед импортом и exact readback после success/failure/no-op.
- Точное узкое исключение AGENTS §21 под перечисленные файлы/таблицы/grants.
- Совместимость `assertRemoteRoles` в `worker/lib/dexie-cloud-membership.ts` только
  с точным одобренным communications profile. Сейчас он сравнивает ключи/таблицы
  permissions с allowlist; молчаливое расширение ролей сломает новые приглашения.

| Таблица | Cloud primary key | Предлагаемые локальные индексы |
| --- | --- | --- |
| discussionThreads | id | realmId, [realmId+coachClientId], [realmId+anchorKey], [realmId+lastActivityAt] |
| discussionMessages | id | realmId, [realmId+threadId], [realmId+threadId+createdAt], [realmId+authorUserId] |
| discussionReadStates | id | realmId, [realmId+threadId+userId] |
| messageAttachments | id | realmId, [realmId+messageId] |

Предложение минимальных общих grants: добавить обеим существующим ролям только
`add: [discussionThreads, discussionMessages, discussionReadStates]` и
`update: { discussionThreads: [lastActivityAt] }`. Метаданные вложений пока только
в schema; обычные shared-realm writes для них не включать до media-этапа.
Широкие update/manage на messages/read-state не нужны: они дали бы правку чужих записей.
Политику `owner` окончательно выбрать до утверждения overlay (§ ниже).

Никаких изменений остальных таблиц/полей, PLAN/FACT, membership, owner/realm transfer,
новых ключей или новых ролей. Не расширять действующие операторы. Не выполнять
protected действия в PR/push. Разрешение **подготовить** этот оператор не означает
разрешение **запустить Apply**. COMM-02 и live проверки обычными аккаунтами остаются
условием применения/активации; локальные permission unit tests не заменят сервер.

## Подтверждённое ограничение ACL, требующее решения

Официальный контракт [Dexie access control](https://dexie.org/docs/cloud/access-control)
и [DBPermissionSet](https://dexie.org/docs/cloud/DBPermissionSet) задаёт следующее:

1. При `owner = author` автор может изменить/удалить свою запись; другой участник
   с одним add-grant не может изменить её. Но владелец может менять **любые** поля
   своей записи, включая owner/realm и provenance, независимо от field allowlist роли.
2. При ownerless/realm-sentinel rows полевой allowlist защищает provenance, но update
   разрешение применяется к участникам роли/realm: оно не выражает условие
   `authorUserId == currentUser`. Выдавать его обоим — разрешить менять чужой текст.
3. Ссылки threadId/replyToMessageId не являются server-enforced foreign keys.
   Проверка same-thread/domain association в репозитории сама по себе не доказывает
   такую же проверку сервером Dexie. Новых ACL на каждый anchor не предлагается.

Поэтому одновременно обещать «обычный owner», «строго неизменяемый сервером автор/
thread/realm» и «никаких дополнительных серверных механизмов» нельзя на основании
проверенного DBPermissionSet. Это конкретное ограничение модели, а не сценарий,
ради которого нужно автоматически усложнять MVP.

Предлагаемый простой вариант для решения владельца: штатная owner-модель
защищает чужие сообщения/read-state на сервере; собственность и принадлежность
проверяются в типизированном репозитории при нормальных действиях, неизменяемость
provenance **не объявляется отдельной server-enforced гарантией**. Это явное
уточнение строгого требования #638/AGENTS, а не уже принятое решение.

Если строгая серверная неизменяемость остаётся обязательной, сначала согласовать
поддерживаемую техническую возможность/модель с Dexie. Не добавлять автоматически
backend CRUD, per-author/per-message realms, доверенный журнал, специальную
криптографию или новые membership/grant-слои. До решения не активировать схему/ACL.

## Завершение отношений: что найдено в текущем коде

`relationshipMembership` создаёт ownerless realm и две ownerless accepted membership
с существующими ролями coach/client. `checkApprovedAssignedPair` проверяет именно
этот канонический realm, ровно двух участников и роли. Нет отдельной синхронизируемой
модели endedAt; legacy D1 relationship status не является источником cloud membership.
В просмотренных production путях `src`, `worker`, `tools` не обнаружена операция
завершения сотрудничества, удаляющая эти membership. Это source review, не live audit.

Не создавать такой endpoint или перезаписывать membership ради задачи. В будущем
бизнес-состояние «сотрудничество закончено» само по себе не должно удалять доступ
к прежним shared rows. Если будет выбран перевод бывших участников на read-only,
это отдельное изменение: текущий `checkApprovedAssignedPair` требует точные роли и
пустые explicit permissions, а глобальные роли дают права и другим доменам.
Сначала согласовать минимальное изменение, не объявлять retention механизмом ACL.

## Выполненная проверка и оставшаяся работа

Изучены root AGENTS, local-first/communications, реальные occurrence/execution types,
approved relationship, provisioner/assertRemoteRoles, cloud roles, protected Flex
operator/workflow и audit. Runtime, DB version, tests и live configuration не менялись.
Обновлён communications §10 и связанные формулировки согласно уже принятому #638.
Локальные npm/typecheck/tests/build не запускались.

После решения по owner и точному оператору: typed anchor/contracts + append-only
local/cloud schema, узкий profile/operator и unit/contract tests. Не называть
клиентскую проверку server permission test; ordinary-account live tests отдельно.
Нужны случаи двух тренеров/одного клиента, устройств, same-thread reply, namespace,
перестановок/удалённого исходного объекта, новых FACT экземпляров и исторического доступа.
