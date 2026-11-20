# MIG-05 — MezfitImportPlan v1 / Business Mapping Engine

**Статус:** реализуемый чистый read-only/dry-run контракт; не является разрешением на запись или протоколом Import Publisher. **Версия предметной политики:** caller-supplied `policyVersion` (пример `MIG-05/v1`), **schemaVersion:** `1`.

**Вход:** исключительно прошедший `isSourceImportPackage` объект [MIG-04](migration-source-contract.md), фиксированные календарные границы и момент оценки, независимые read-only снимки каталога, соответствий, целевого контекста, занятости, реестра импортов и выбора тренера.

**Выход:** `MezfitImportPlanV1` с документируемой идентичностью, непрерывным графом зависимостей, типизированными предметными proposed operations, issues, omitted/loss report, preview и readiness. Код: `migration/business-mapping/{types,validate,canonical,measure,timing,plan}.ts`; публичный API — `buildMezfitImportPlan(input): Promise<MezfitImportPlanV1>`, `isBuildMezfitImportPlanInput(value)`, `isMezfitImportPlan(value)`.

## 1. Trust boundary и неизменяемые бизнес-правила

- Период `YYYY-MM-DD` **включительно** применяется только к исходным sessions и scheduled workouts по достоверной исходной бизнес-дате. Программы без временного диапазона подтягиваются **только по связям** выбранных тренировок, целиком: каждая фаза, день, упражнение, подход с исходным порядком. `createdAt` программы — техническое поле и не фильтр.
- Для scheduled операция не формируется, если **любая** session из всего доступного пакета связана с ней явным `scheduledWorkoutRef.state='linked'` и точно тем же `sourceKey` — даже если session вне периода. По похожести имени/даты/program такого вывода нет. Несколько связанных sessions переносятся независимо. При `coverage.sessions !== 'complete'` невозможно доказать отсутствие других sessions: standalone scheduled получает `SCHEDULE_LINK_UNCERTAIN`.
- Незавершённая `in_progress` и `unknown` session **остаётся кандидатом**, но блокируется `UNKNOWN_COMPLETION`, а не маскируется под completed.
- **PROGRAM = STRUCTURE**, только порядок, set type/label/comment и исходные атрибуты; никакого числового planned/actual. Числовой PLAN бывает только у достоверного `SourceScheduledWorkout.plan.present` и отдельно `SourceSession.frozenPlan.present`. FACT только из `performedExercises[].sets[].metrics`; FACT не заполняет frozen PLAN. Историческая Ad-hoc может быть FACT-only. `completed` — lifecycle, `imported` — отдельный proposed provenance marker.
- Существующие программы источника не склеиваются и не заменяют действующую активную Mezfit. Конфликт — `ACTIVE_PROGRAM_CONFLICT`, dependencies блокируются. Если отсутствие программы источника доказано (`programRef.none`, `scheduledWorkoutRef.none`, необходимое coverage.complete), предложить **одну** программу/фазу/день из последней однозначно завершённой сессии выбранного периода. Все исторические сессии остаются Ad-hoc, без обратной привязки. `unknown/not_in_export` не означает `none`. Отсутствующая последняя completed и ничья по достоверному времени дают отдельные issues.
- Exercise identity включает исходные `sourceApp`, `formatFamily`, `formatVersion`, caller `datasetKey`, subject и `sourceKey`. Стабильные exercise-mapping records используются всеми дочерними операциями. Точное **единственное** name+equipment+tracking совпадение в полном каталожном снимке даёт catalog match; явный ранее подтверждённый registry match проверяется по каталогу. При отсутствии/неоднозначности совпадений и наличии доказанного trackingType+sourceName создаётся **только ProposedCustomExercise** в плане с `requiresReconciliation=true`. Это не запись в публичный/личный каталог, не ready-made Dexie row. Неизвестное имя/tracking — block, не эвристика.
- Единицы weight kg/g/lb/lbs, duration s/sec/ms/min/h, distance m/km/cm/mi/ft переводятся соответственно в **kg / seconds / meters**; precision — шесть знаков после запятой с half-up округлением, невалидные/невосстановимые значения блокируются. Хранятся `sourceMetrics` и `ConvertedMeasurement.originalValue/originalUnit/precision`. Zero сохраняется как число, не null. Несовместимый trackingType — `TRACKING_METRICS_CONFLICT`. Никогда не переносить неизвестное значение как 0 или silent omission. При несопоставимых типах подходов/меток — issue, без silent default.
- Дополнительные source attributes остаются в proposed evidence, но не в неутверждённых полях Flex. `SourceImportPackage.omittedData` (включая measures) попадает в отчёт; measures не импортируются. Публичный trace не должен включать sourceKey, ФИО, тренировочные числа, токены, Telegram идентичности или realm.
- Для `precision=date` с достоверной IANA zone — **только предложение** детерминированного 08:00, 08:30... локального времени, в пределах дня, исключая занятые в caller-supplied snapshot точки и ранее предложенные starts. В DST fold выбирается ранний UTC instant, в DST gap несуществующее local время пропускается. Точная исходная дата и оригинал UTC/zone сохраняются. Без достоверного end/duration, полного резервирования интервала или зоны нет права утверждать, что слот может быть опубликован — `TIME_DURATION_UNKNOWN`/другой issue блокирует зависимую операцию. Имеющийся `SourceWorkoutTiming.completedAtUtc` НЕ является scheduled end. `missed=undetermined` до доказанного scheduled endsAt; в MIG-04 v1 такого поля нет.
- Идентичность операции не основана только на `inputSha256`: при перекрывающемся новом экспорте те же training keys в namespace не создают дубликаты, если внешний `existingImportsSnapshot.identities` их перечисляет. Existing FACT **не обновляется** автоматически.
- Partial allowed только с **явной будущей** selection/approval model; вне периода — `preview.outsidePeriod` (не ошибка), выбранные исключения тренера — `excluded_by_coach`, registry replay — `already_imported`, invalid — `blocked`. При блокировке зависимости блокируется дочерняя операция, без orphan refs/child sets.

## 2. Входные снимки и их доказательная сила

`BuildMezfitImportPlanInput` имеет **только** поля:

| Поле | Смысл |
| --- | --- |
| `sourcePackage` | MIG-04 `SourceImportPackageV1` после повторной runtime-валидации |
| `period` | `fromDate`, `throughDate`, IANA `selectionTimeZone`; относительный диапазон уже материализован вызывающим |
| `evaluatedAtUtc` | Неизменный timestamp оценки, никогда не `Date.now()` внутри маппера |
| `policyVersion` | Явная строка версии бизнес-правил |
| `targetContextSnapshot` | `datasetKey`, `bindings[]` по source subject; `activeProgramSubjectKeys[]` для conflict diagnostics |
| `catalogueSnapshot` | `completeness`, безопасные `entries[] {id,scope,name,equipment,trackingType}`; **не** права на этот каталог |
| `mappingSnapshot` | Reviewed entries `{identityKey,catalogueExerciseId}`; registry ключ должен совпасть с вычисленным namespace |
| `calendarOccupancySnapshot` | `intervals[] {startsAtUtc,endsAtUtc}` всех занятых интервалов соответствующего тренера; независимые тренировки не занимают тренера |
| `existingImportsSnapshot` | Уже импортированные независимые operation identity keys |
| `selectionSnapshot` | `exclusions[] {kind,sourceKey}` в будущей модели предварительного выбора; не утверждение переноса |

`TargetBinding` discriminant: `existing_client` содержит только непроверенную пока ссылку `targetClientId`; `provisional_imported_client` — opaque `provisionalKey`, не Telegram ID/realm; `unresolved` блокирует связанные операции. Все ACL, membership, «Imported Client» и Clone & Rebind остаются дальнейшими отдельными решениями. Данные snapshots не являются server evidence/authorization; Publisher позже обязан повторно загрузить/проверить права/состояния.

Схемы input/output используют закрытые discriminated unions и рекурсивное ограничение ресурсов: max 10,000 JSON nodes, 24 уровней, 4 MiB приблизительного текста, ограниченные списки и scalar fields; запрещены циклы, экзотические прототипы для типов записей, лишние поля, нарушенные foreign/dependency keys и циклы операций. MIG-04 validator дополнительно контролирует свои отдельные caps. Runtime ошибки имеют код `IMPORT_PLAN_INVALID_INPUT` / `IMPORT_PLAN_INVALID_OUTPUT` без PII.

## 3. Контракт выхода

```ts
interface MezfitImportPlanV1 {
  kind: 'mezfit.import-plan';
  schemaVersion: 1;
  planId: string; // SHA-256 hex
  policyVersion: string;
  source: { packageSha256: string; datasetKey: string; sourceApp: string;
    formatFamily: string; adapterId: string; adapterVersion: string; inputSha256: string };
  scope: { fromDate: string; throughDate: string; selectionTimeZone: string;
    evaluatedAtUtc: string; selectedEntityTypes: ['session','scheduledWorkout']; programs: 'linked-only' };
  inputs: { catalogSnapshotHash: string; targetSnapshotHash: string;
    mappingSnapshotHash: string; occupancySnapshotHash: string;
    existingImportsSnapshotHash: string; selectionSnapshotHash: string };
  targetBindings: TargetBinding[];
  exerciseMappings: ExerciseMapping[];
  operations: ImportOperation[];
  selections: ImportSelection[];
  issues: MappingIssue[];
  omittedData: OmittedData[];
  preview: ImportPreview;
  readiness: 'ready_for_review' | 'requires_decisions' | 'blocked';
}
```

Для `historical_session` поле `sourceProgramRef` — **буквальная** ссылка из session источника, а `programRef` — отдельно **разрешённая** program-связь (возможно транзитивно через linked scheduled). При `sourceProgramRef.none` и доказанной цепочке `scheduled.programRef.linked` они могут различаться, не подменяя provenance. Имена автоматически предложенных фазы/дня — явно генерируемые planning labels, а не вымышленные названия из source.

**Typed ImportOperation**: `program` с предложением полного структурного graph; `historical_session` со source completionState, независимыми `frozenPlan`/`fact` и timestamp provenance; `standalone_scheduled` с независимым PLAN; `proposed_custom_exercise`; `provenance_metadata` с маркером imported. У каждой есть `operationKey`, source refs, `targetBindingRef`, `dependencyKeys`, `reasonCodes`, `evidence`, `losses`, `state`. Это **не** generic `{table,action,row}` и не Dexie Entity; отсутствуют реальные realm/owner IDs.

**Группы ImportSelection** описывают `operationKeys`, состояние `selected/excluded_by_coach/blocked/already_imported`, reasons, транзитивный `dependencyClosure`. Независимые выбранные компоненты могут пройти вперёд в будущем Publisher только при отдельном подтверждении тренера. `ready_for_review` — нет блокирующих операций в данном плане, но **никогда** не publishable. `requires_decisions` — есть и blocked, и независимые selected. `blocked` — нет независимых готовых к review операций.

**Канонический хеш.** `canonical(value)` сортирует имена полей JSON, стабилизирует явно неупорядоченные collections по устойчивому ключу с tie-break, сохраняет domain `position` для nested ordered sets/days, затем `SHA-256(UTF-8(canonical(value)))`. `planId = digest({kind,schemaVersion,policyVersion,source,scope,inputs,targetBindings,exerciseMappings,operations,selections,issues,omittedData,preview,readiness})`. PlanId не криптографическая подпись полномочий. Изменение пакета, границ, оценочного времени, версии политики или любого релевантного snapshot даёт новый план и требует повторного review. Стабильные exercise/operation identities используют отдельный namespace, поэтому не меняются при одном только новом хеше экспортных байтов. Режим частичного импорта никогда не допускает скрытое удаление упражнений или отдельных sets.

## 4. Полный пример небольшого набора

Source dataset `test-diary / test-family / source-dataset-2026` содержит клиента `subject:p`, программу `p:old` (создана в 2022), фазу `phase:a`, день `day:a` с `Bench Press` (два подхода) и `Static hold` (один подход). Исходные упражнения: `ex:bench` с `trackingHint=weight_reps, equipment=barbell` и `ex:hold` с `trackingHint=time`. Snapshot каталога полный и содержит только `0001 / Bench Press / barbell / weight_reps`.

Период **2026-10-01 — 2026-10-31** включительно, выбор тренера `Europe/Warsaw`, `evaluatedAtUtc=2026-11-20T10:00:00.000Z`. В SourcePackage: completed `ses:linked` от 10 октября явно ссылается на `sw:linked`, frozen PLAN (10 reps / 50 kg) и FACT (8 reps / 55 kg); completed `ses:adhoc` от 11 октября — без программы/occurrence/frozen PLAN, FACT duration 1 min; `sw:linked` от 10 октября — PLAN 10 reps/100 lb; `sw:solo` от 12 октября — independent scheduled с PLAN 12 reps/0 kg. `coverage.sessions='complete'`. Omitted measures — 3.

| Сущность в preview | Результат |
| --- | --- |
| `ses:linked` | одна historical_session, completed + `imported`, frozen PLAN/FACT **отдельно** |
| `ses:adhoc` | historical_session FACT-only, programmeRef.none, imported marker |
| `sw:linked` | **не** создаётся standalone: явная связь с `ses:linked` |
| `sw:solo` | standalone scheduled candidate, numeric PLAN сохраняется, но `SCHEDULE_END_UNKNOWN` блокирует выпуск до прояснения schedule end |
| `p:old` | одна proposed program **со всеми** фазой, днём и тремя структурными подходами; без numeric PROGRAM PLAN |
| `ex:bench` | `catalog_match` к `0001` (однозначное точное совпадение) |
| `ex:hold` | одна `proposed_custom_exercise`, `trackingType=time`, requiresReconciliation; ею пользуются и программа, и FACT |

**Пример структурного fragment операции** (значения ключей ниже иллюстративны; реальные `imp:<sha256>` рассчитываются движком, не подставляются вручную):

```json
{
  "kind": "historical_session",
  "completionState": "completed",
  "sourceProgramRef": {"state":"linked", "sourceKey":"p:old"},
  "programRef": {"state":"linked", "sourceKey":"p:old"},
  "scheduledWorkoutRef": {"state":"linked", "sourceKey":"sw:linked"},
  "frozenPlan": {"state":"present", "exercises":[
    {"sourceKey":"fp:e1", "position":0, "exerciseMappingKey":"imp:<computed>",
     "sourceProgramExerciseRef":{"state":"linked","sourceKey":"pe:bench"},
     "sets":[{"sourceKey":"fp:s1","position":0,
       "sourceProgramSetRef":{"state":"linked","sourceKey":"ps:1"},
       "sourceSetType":null,
       "sourceMetrics":{"reps":10,"weight":{"value":50,"unit":"kg"},"duration":null,"distance":null},
       "metrics":{"reps":10,"weight":{"value":50,"unit":"kg","originalValue":50,"originalUnit":"kg","precision":6},"duration":null,"distance":null}
     }]}
  ]},
  "fact":[{"sourceKey":"fx:e1","position":0,"exerciseMappingKey":"imp:<computed>","notes":null,
    "sets":[{"sourceKey":"fx:s1","position":0,"planSetRef":{"state":"linked","sourceKey":"fp:s1"},
     "sourceSetType":null,"sourceSetLabel":null,
     "sourceMetrics":{"reps":8,"weight":{"value":55,"unit":"kg"},"duration":null,"distance":null},
     "metrics":{"reps":8,"weight":{"value":55,"unit":"kg","originalValue":55,"originalUnit":"kg","precision":6},"duration":null,"distance":null},
     "setStatus":"completed","rpe":7,"comment":null,"sourceAttributes":[]}
    ]}]
}
```

Этот fragment показывает содержимое полей одной операции, без общих ключей envelope `operationKey`, `dependencyKeys`, `targetBindingRef`, `sourceRefs` и `evidence`, которые обязательно присутствуют в полном машинном объекте. В исходном примере `preview.source={sessions:2,scheduledWorkouts:2,programs:1,exercises:2}`, `linkedScheduledSuppressed=1`, `proposedCustomExercises=1`, `catalogMatched=1`, `omittedMeasures=3`. `preview.selected` зависит от блокировок; завершённые валидные сессии остаются независимыми candidates. `readiness='requires_decisions'` из-за `sw:solo`; без подтверждения и доказанного расписания ничего не публикуется.

## 5. Пример частичного импорта

Тот же dataset, но у FACT подхода `fx:s1` единица веса `stone`. MIG-04 сохраняет оригинал и выдаёт `UNKNOWN_UNIT`. MIG-05 оставляет `sourceMetrics.weight={value:55,unit:'stone'}`, отмечает `UNSUPPORTED_UNIT`, блокирует всю `ses:linked` (не удаляет один сет или весь источник). Provenance metadata для неё также блокируется через dependency closure. `ses:adhoc` остаётся `selected` и в будущем может быть включена в частичную публикацию при явном подтверждении отчёта. `sw:solo` независимо blocked из-за отсутствия scheduled end. `preview.blocked`, `issuesByCode`, `operations[].reasonCodes`, `selections[].dependencyClosure` раскрывают точный состав потерь/блокировок. Если тренер явно откажется от программы, зависимые связанные тренировки блокируются, а независимые Ad-hoc — нет.

## 6. Реализовано / намеренно не реализовано

В MIG-05 реализованы in-memory planning, строгий runtime input/output validator, frozen period/asOf, source linked closure, session priority, конверсия, deterministic proposed time, unique match/proposed custom, replay snapshot, typed partial report, unit+contract tests.

**Не реализованы и не разрешены в этом PR:** реальный Gym Keeper decoder, AI Adapter Builder/API, модель сессий `in_progress` для будущего storage, scheduled duration/end extension MIG-04, реальные записи Dexie/IndexedDB/Dexie Cloud, R2 business archives, Flex/realm/ACL, пользовательское упражнение в DB, Imported Client storage, invitation/Clone & Rebind, Exercise Reconciliation, автоматическое обновление уже импортированного FACT, UX выбора, approve/publish, реальный календарный показ imported Ad-hoc, новый sync engine, изменение MIG-03/04 processor schema/D1 lifecycle/лимитов. Все snapshots требуется получить по отдельным будущим авторизованным источникам. Эти отсутствия не заполняются фиктивными ID, end timestamps, привилегиями или default values.

**Дальнейшие решения владельца:** точная политика отсутствующей даты/времени, источник гарантированного scheduled end/duration; разрешённая схема публикации provisional client; canonical mapping целевых определений и их фактическая авторизация; lifecycle неполных sessions, synthetic-program conflict; возможности Flex; post-import reconciliation. В отсутствие решения — issue/blocked, не авто-эскалация прав.
