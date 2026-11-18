# MIG-04 — Universal SourceImportPackage v1

**Статус:** утверждённая предметная архитектура и проект wire-контракта v1 для реализации MIG-04. Документ не означает наличия опубликованной JSON Schema, готового адаптера реального формата или возможности записи в Dexie Cloud.
**Основание:** согласованная модель Mezfit; уточнение владельца 18.11.2026 о границе PROGRAM / OCCURRENCE / SESSION.
**Связанные документы:** [migration.md](../../migration.md) (§15), [domain-model.md](domain-model.md), [local-first-storage-sync.md](local-first-storage-sync.md).
**Реализация, которую необходимо соблюдать:** `src/data/cloud/workout-foundation-types.ts`, `src/data/cloud/workout-occurrence-plan.ts`, `shared/workout-occurrence-plan.ts`, `src/data/cloud/adhoc-workout-types.ts`.

## 1. Назначение и граница ответственности

`SourceImportPackage v1` — унифицированный, независимый от стороннего приложения **слой извлечённых исходных фактов**, который выдаёт любой проверенный import adapter. Смысл его сущностей определяется доменом Mezfit; структура **не является копией таблиц Dexie Cloud** и не предназначена для непосредственного `put` / `bulkPut`.

~~~text
Сторонний файл → format adapter → SourceImportPackage v1 (исходные сведения)
  → проверка связей, разрешение пользователей/упражнений/единиц
  → MezfitImportPlan (отдельный будущий контракт бизнес-операций)
  → preview + подтверждение тренера
  → авторизованная запись в Dexie Cloud → ImportReceipt
~~~

Adapter **извлекает**; Business Mapping Engine **принимает решения**; Import Publisher **проверяет права и записывает**. Адаптер никогда не создаёт realm, membership, приглашение, ID Mezfit, программу по умолчанию, искусственное время, match каталога или записи Dexie. Обратная совместимость текущего MIG-03 synthetic Engine обязательна.

### 1.1. Основной инвариант Mezfit

| Уровень | Что хранится по смыслу | Числовые веса/повторения/время/дистанция |
| --- | --- | --- |
| **PROGRAM = STRUCTURE** | Программа → фаза → день → упражнение → **подход**; порядок, тип, метка, комментарий | **Нет.** Минимальная структурная единица — подход без числового наполнения |
| **OCCURRENCE = PLAN** | Конкретная запланированная тренировка, собственный план и значения для подходов | **Да, если присутствуют в источнике** |
| **SESSION = FROZEN PLAN + FACT** | Собственный достоверный снимок PLAN, если он существовал, плюс независимые выполненные подходы FACT | PLAN и FACT **раздельно**, без взаимной подмены |
| **AD-HOC SESSION = FACT** | Самостоятельная тренировка, не требующая source program, occurrence или frozen PLAN | Только фактические значения, если нет доказанного отдельного frozen PLAN |

Это подтверждается `snapshotProgramDay()`: при материализации структуры в `WorkoutOccurrence.plan` поля `plannedReps` / `plannedWeightKg` / `plannedDurationSeconds` / `plannedDistanceMeters` из программы **сбрасываются в `null`**. Наличие одноимённых nullable-полей в `CloudProgramSetRow` — техническая особенность текущего типа, **не** разрешение сохранять числовой PLAN на программе.

**Запрет:** поля `SourceProgramSet` не содержат `plannedReps`, `plannedWeight`, `plannedDuration`, `plannedDistance` и не получают FACT из выполненной сессии.

## 2. Корневой формат

Семантический wire shape; TypeScript ниже является **эталоном для будущей реализации и runtime-валидации**, а не существующим экспортируемым интерфейсом.

~~~ts
interface SourceImportPackageV1 {
  kind: 'mezfit.source-import';
  schemaVersion: 1;
  provenance: SourceProvenance;
  coverage: SourceCoverage;
  subjects: SourceSubject[];
  sourceExercises: SourceExercise[];
  programs: SourceProgram[];
  scheduledWorkouts: SourceScheduledWorkout[];
  sessions: SourceSession[];
  issues: SourceImportIssue[];
  omittedData: OmittedDataSummary[];
}

interface SourceProvenance {
  sourceApp: string;
  formatFamily: string;
  formatVersion: string | null;
  adapterId: string;
  adapterVersion: string;
  inputSha256: string; // 64 lowercase hexadecimal chars
  exportKind: 'full_backup' | 'training_history'
    | 'program_only' | 'mixed' | 'unknown';
}

type SourceCoverageState = 'complete' | 'partial'
  | 'not_in_export' | 'unknown';

interface SourceCoverage {
  subjects: SourceCoverageState;
  sourceExercises: SourceCoverageState;
  programs: SourceCoverageState;
  scheduledWorkouts: SourceCoverageState;
  sessions: SourceCoverageState;
  measures: SourceCoverageState;
}
~~~

`coverage=complete` означает, что адаптер имеет достаточные доказательства полноты **данной категории именно в границах этого экспорта**, а не во всей истории стороннего приложения. `not_in_export` означает отсутствие категории в *типе выгрузки*, а **не доказанное отсутствие у пользователя программ**. Пустой массив `programs` сам по себе не означает, что сессии были без программы.

Происхождение не является авторизацией: исходное имя, ID человека и идентификаторы из дампа нельзя использовать как Telegram identity или Dexie realm.

## 3. Общие строительные блоки

~~~ts
type SourceRef =
  | { state: 'linked'; sourceKey: string }
  | { state: 'none' }
  | { state: 'unknown' };

interface SourceMeasurement {
  value: number;
  unit: string | null;
}

interface SourceSetMetrics {
  reps: number | null;
  weight: SourceMeasurement | null;
  duration: SourceMeasurement | null;
  distance: SourceMeasurement | null;
}

interface SourceWorkoutTiming {
  localDate: string | null;          // YYYY-MM-DD, если достоверна
  startedAtUtc: string | null;       // UTC instant, если достоверен
  completedAtUtc: string | null;     // UTC instant, если достоверен
  timeZone: string | null;           // исходная IANA zone, если известна
  precision: 'instant' | 'minute' | 'date' | 'unknown';
}

// Только явно извлечённое скалярное поле; не свободный JSON/Blob.
// Единица обязательна как поле для числового варианта, но может быть null.
type SourceAttribute =
  | { name: string; kind: 'string'; value: string }
  | { name: string; kind: 'number'; value: number; unit: string | null }
  | { name: string; kind: 'boolean'; value: boolean }
  | { name: string; kind: 'null'; value: null };
~~~

- `linked` — реальная исходная связь. Её `sourceKey` указывает на объект правильного типа. Если объект не был выгружен, фиксируется `UNRESOLVED_SOURCE_REFERENCE`; связь **не** превращается в `none`.
- `none` — доказанное отсутствие связи в исходном приложении. `unknown` — данных недостаточно, чтобы сделать вывод.
- `null` у конкретной метрики означает, что значение не было извлечено; `0` — измеренное нулевое значение. Метрики должны быть конечными числами; `reps` — целое неотрицательное, остальные — неотрицательные. Неизвестная единица — `unit: null` + issue, а не догадка `kg`.
- `precision='date'` разрешает дату без времени; локальную дату нельзя выдумать из UTC без обоснованного часового пояса. Технические `createdAt/updatedAt` не являются реальным временем тренировки.
- Исходные комментарии и атрибуты — приватные данные. В Cloudflare traces допускаются **только диагностические коды**, а не значения.
- `SourceAttribute` хранит дополнительные свойства источника, **не является готовой записью Flex**. Будущая запись во Flex требует отдельного entity scope, типизации и проверки ACL.

## 4. Участники и каталог исходных упражнений

~~~ts
interface SourceSubject {
  sourceKey: string;
  displayName: string | null;
  sourceContainerKeys: string[];
  sourceAttributes: SourceAttribute[];
}

interface SourceExercise {
  sourceKey: string;
  sourceName: string | null;
  aliases: string[];
  equipment: string | null;
  movementType: string | null;
  bodyPart: string | null;
  primaryMuscles: string[];
  trackingHint: 'weight_reps' | 'time' | 'time_distance'
    | 'time_reps' | 'time_weight' | null;
  sourceAttributes: SourceAttribute[];
}
~~~

`SourceSubject` — исходный владелец/атлет/контейнер дневника, **не** готовый Coach/Client в Mezfit. Одному «Diary» не назначать реального клиента без подтверждения. Экспорт без сведений о клиенте может содержать пустой `subjects` и `subjectRef: {state:'unknown'}` либо `none`, если отсутствие связи достоверно; выбор человека откладывается до preview.

`SourceExercise` — одно определение на стабильный исходный ключ. Каждый экземпляр упражнения в программе, occurrence и session ссылается на него. `equipment/movementType/bodyPart/primaryMuscles` — **термины источника**, не значения таксономии Mezfit. `trackingHint` допускается только при достоверной семантике; точный `exerciseDefinitionId`, scope каталога и `CloudWorkoutExerciseSnapshot` назначает отдельный Exercise Mapping Engine. Его алгоритм и пороги согласовываются отдельно (§15.6 migration.md).

## 5. PROGRAM — только структура

~~~ts
interface SourceProgram {
  sourceKey: string;
  subjectRef: SourceRef;
  name: string | null;
  phases: SourcePhase[];
  days: SourceProgramDay[];
  sourceAttributes: SourceAttribute[];
}

interface SourcePhase {
  sourceKey: string;
  name: string | null;
  position: number;
  sourceAttributes: SourceAttribute[];
}

interface SourceProgramDay {
  sourceKey: string;
  phaseRef: SourceRef;               // none, если фаз в источнике нет
  name: string | null;
  position: number;
  exercises: SourceProgramExercise[];
  sourceAttributes: SourceAttribute[];
}

interface SourceProgramExercise {
  sourceKey: string;
  exerciseSourceKey: string;
  position: number;
  notes: string | null;
  sets: SourceProgramSet[];
  sourceAttributes: SourceAttribute[];
}

interface SourceProgramSet {
  sourceKey: string;
  position: number;
  sourceSetType: string | null;
  sourceSetLabel: string | null;
  comment: string | null;
  sourceAttributes: SourceAttribute[];
  // НЕТ числовых planned*/actual* полей.
}
~~~

Самый нижний уровень — отдельный структурный подход: его позиция, тип и примечания. `phases: []` допустим; адаптер **не** создаёт фазу Mezfit ради выполнения его требований. Синтез необходимой фазы, одного дня по последней выполненной тренировке и статуса active — только будущий `MezfitImportPlan`.

**Числовые предписания внутри программы стороннего приложения:** если источником достоверно сохранены «3×10 по 80 кг» прямо в шаблоне, адаптер сохраняет их как **типизированные `sourceAttributes` соответствующих исходных подходов**, например `{name:'source_planned_weight',kind:'number',value:80,unit:'kg'}`, и добавляет issue `SOURCE_PROGRAM_NUMERIC_PRESCRIPTION`. Он не создаёт из этих значений `SourcePlanSet`, `SourceScheduledWorkout` или числовой PROGRAM Mezfit. Возможное использование таких сведений в будущем назначенном occurrence — **отдельное решение Business Mapping Engine, не правило MIG-04**.

## 6. SCHEDULED WORKOUT — PLAN для конкретной даты

~~~ts
type SourcePlanPresence =
  | { state: 'present'; exercises: SourcePlanExercise[] }
  | { state: 'absent' }
  | { state: 'unknown' };

interface SourceScheduledWorkout {
  sourceKey: string;
  subjectRef: SourceRef;
  programRef: SourceRef;
  programDayRef: SourceRef;
  name: string | null;
  timing: SourceWorkoutTiming;
  plan: SourcePlanPresence;
  sourceAttributes: SourceAttribute[];
}

interface SourcePlanExercise {
  sourceKey: string;
  exerciseSourceKey: string;
  sourceProgramExerciseRef: SourceRef;
  position: number;
  sets: SourcePlanSet[];
}

interface SourcePlanSet {
  sourceKey: string;
  sourceProgramSetRef: SourceRef;
  position: number;
  sourceSetType: string | null;
  metrics: SourceSetMetrics; // числовые значения PLAN — здесь
}
~~~

`plan.state='present'` — исходник действительно содержит план конкретной запланированной тренировки. `absent` — доказанное отсутствие, `unknown` — невозможность установить. Эти три значения не взаимозаменяемы. Если исходный файл не содержит occurrences, `scheduledWorkouts=[]`; **не создавать фиктивные occurrences для исторического FACT**.

## 7. SESSION — источник исторических FACT и возможного frozen PLAN

~~~ts
interface SourceSession {
  sourceKey: string;
  subjectRef: SourceRef;
  scheduledWorkoutRef: SourceRef;
  programRef: SourceRef;
  name: string | null;
  timing: SourceWorkoutTiming;
  completionState: 'completed' | 'in_progress' | 'unknown';
  frozenPlan: SourcePlanPresence;
  performedExercises: SourcePerformedExercise[];
  sourceAttributes: SourceAttribute[];
}

interface SourcePerformedExercise {
  sourceKey: string;
  exerciseSourceKey: string;
  position: number;
  notes: string | null;
  sets: SourceFactSet[];
}

interface SourceFactSet {
  sourceKey: string;
  position: number;
  planSetRef: SourceRef;
  sourceSetType: string | null;
  sourceSetLabel: string | null;
  metrics: SourceSetMetrics;           // отдельный FACT
  setStatus: 'pending' | 'completed' | 'skipped' | 'unknown';
  rpe: number | null;
  comment: string | null;
  sourceAttributes: SourceAttribute[];
}
~~~

`frozenPlan.state='present'` допустим **только при наличии в исходном файле именно снимка PLAN сессии**. Нельзя реконструировать его из текущей программы, будущего occurrence, `previous` или FACT. Если у источника отсутствует понятие frozen PLAN, `absent` допустимо только при доказанном отсутствии, иначе `unknown`.

FACT — фактически выполненные подходы и измерения. При наличии source `planSetRef` ссылка связывает FACT с соответствующим исходным frozen PLAN set; отсутствие соответствия не исправляется подстановкой «первого подхода».

Сессия без программы, occurrence и frozen PLAN — корректный **Ad-hoc source**. В таком случае три независимые ссылки могут иметь `{state:'none'}`, а `frozenPlan={state:'absent'}`. Она не теряет собственные `performedExercises` и `sets`.

Перенос всех подтверждённо завершённых сессий, включая последнюю, в завершённые Ad-hoc и создание **одной активной программы/одного дня только из структурного состава последней сессии** — существующее бизнес-решение в `migration.md §15.5`. Оно применяется позже, **не адаптером**. Исторические фактические 75 кг × 8 не становятся числовым PLAN программы.

## 8. Пример полного минимального пакета без программы

Обезличенная синтетическая иллюстрация: исходная запись **конкретной сессии** явно подтверждает отсутствие связи с программой и occurrence; дата известна, точного времени нет. Категории программ и расписания не входят в этот тип экспорта (`not_in_export`), поэтому их пустые массивы **не доказывают отсутствия программ в приложении вообще**. Достоверность `programRef.none` и `scheduledWorkoutRef.none` основана только на полях самой сессии.

~~~json
{
  "kind": "mezfit.source-import",
  "schemaVersion": 1,
  "provenance": {
    "sourceApp": "example-training-app",
    "formatFamily": "example-backup",
    "formatVersion": "2",
    "adapterId": "example-adapter",
    "adapterVersion": "1.0.0",
    "inputSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "exportKind": "training_history"
  },
  "coverage": {
    "subjects": "complete",
    "sourceExercises": "complete",
    "programs": "not_in_export",
    "scheduledWorkouts": "not_in_export",
    "sessions": "complete",
    "measures": "not_in_export"
  },
  "subjects": [{
    "sourceKey": "subject:1",
    "displayName": "Клиент А",
    "sourceContainerKeys": ["diary:1"],
    "sourceAttributes": []
  }],
  "sourceExercises": [{
    "sourceKey": "exercise:42",
    "sourceName": "Bench Press",
    "aliases": [],
    "equipment": "barbell",
    "movementType": "press",
    "bodyPart": "chest",
    "primaryMuscles": ["pectorals"],
    "trackingHint": "weight_reps",
    "sourceAttributes": []
  }],
  "programs": [],
  "scheduledWorkouts": [],
  "sessions": [{
    "sourceKey": "session:100",
    "subjectRef": {"state": "linked", "sourceKey": "subject:1"},
    "scheduledWorkoutRef": {"state": "none"},
    "programRef": {"state": "none"},
    "name": "Chest workout",
    "timing": {
      "localDate": "2026-10-15",
      "startedAtUtc": null,
      "completedAtUtc": null,
      "timeZone": null,
      "precision": "date"
    },
    "completionState": "completed",
    "frozenPlan": {"state": "absent"},
    "performedExercises": [{
      "sourceKey": "performed:1",
      "exerciseSourceKey": "exercise:42",
      "position": 0,
      "notes": null,
      "sets": [{
        "sourceKey": "fact-set:1",
        "position": 0,
        "planSetRef": {"state": "none"},
        "sourceSetType": null,
        "sourceSetLabel": null,
        "metrics": {
          "reps": 8,
          "weight": {"value": 75, "unit": "kg"},
          "duration": null,
          "distance": null
        },
        "setStatus": "completed",
        "rpe": null,
        "comment": null,
        "sourceAttributes": []
      }]
    }],
    "sourceAttributes": []
  }],
  "issues": [],
  "omittedData": []
}
~~~

Этот пакет **не содержит** Realm, `tg:<id>`, `CloudWorkoutExerciseSnapshot`, статуса `imported` или новой активной программы. Все эти решения принадлежат следующему этапу.

## 9. Валидация, неполнота и диагностика

~~~ts
interface SourceImportIssue {
  code: string; // стабильный код из reviewed allowlist
  severity: 'info' | 'warning' | 'error';
  entityType: string | null;
  sourceKey: string | null;
  field: string | null;
}

interface OmittedDataSummary {
  category: string;                 // например 'measures'
  reason: 'unsupported_target' | 'unreadable' | 'not_in_export';
  count: number | null;
}
~~~

### 9.1. Обязательные проверки

1. Проверять точный `kind/schemaVersion` и типы, enum, размеры коллекций, глубину, длины строк, разрешённые ключи, SHA-256; никакой слепой `as SourceImportPackageV1`.
2. Требовать непустые воспроизводимые `sourceKey`. Уникальность ключей — в рамках типа сущности и пакета; внутрипакетные ссылки обязаны разрешаться в объект **ожидаемого типа**. Не склеивать одинаковые ключи разных типов/экспортов/тренеров.
3. `position` — целое неотрицательное, уникальное в пределах родительской последовательности; запрещены дубли `sourceKey` и позиции sibling. Сортировка объектов в массивах не должна определять их идентичность.
4. Проверять, что `SourceProgramDay.phaseRef` указывает на фазу именно его программы, `sourceProgramExerciseRef/SetRef` — на согласованных потомков нужного программного дня, а `planSetRef` — на конкретный источник PLAN, если представлен; циклы и чужие ссылки не маскировать.
5. При частичном экспорте `linked` на невключённый объект → issue `UNRESOLVED_SOURCE_REFERENCE` и блокировка зависимой бизнес-публикации. `unknown` и `none` валидны и **не подменяют** друг друга.
6. У сессии `frozenPlan.present` допустим только на основании source evidence; не заполнять числовые значения из программы или FACT. `SourceProgramSet` не допускает любых numeric PLAN/FACT properties. Неподдержанные числовые source prescriptions — только в sourceAttributes с issue.
7. Метрики — конечные неотрицательные числа, повторения — целые. Единицы должны быть указаны **из источника**; неизвестные или несовместимые единицы → issue, без конвертации по умолчанию. Не допускать незаметного преобразования weight в time при другом `trackingHint`.
8. Даты и UTC проверяются синтаксически и семантически; не создавать таймзону, время/слоты или статус завершения из даты экспорта. Если `completionState=completed`, отсутствие точного `completedAtUtc` само по себе допустимо при date-only источнике и требует последующего правила восстановления.
9. `SourceImportIssue` содержит коды и ссылки, но без raw PII, бинарных blobs, credentials и приватных URL. `sourceAttributes` — ограниченные, явно типизированные значения; неизвестная структура не копируется в произвольный JSON.
10. Должны различаться: **пакет структурно валиден**, **пакет содержит unresolved issues**, **пакет пригоден к конкретной публикации**. Последнее проверяется не адаптером, а Business Mapping Engine/публикатором.

### 9.2. Типовые коды issues

`MISSING_SOURCE_ID`, `DUPLICATE_SOURCE_KEY`, `UNRESOLVED_SOURCE_REFERENCE`, `UNSUPPORTED_SOURCE_FIELD`, `SOURCE_PROGRAM_NUMERIC_PRESCRIPTION`, `UNKNOWN_UNIT`, `DATE_PRECISION_INSUFFICIENT`, `UNKNOWN_PROGRAM_RELATION`, `OMITTED_MEASURES`. Список иллюстрирует будущий нормализованный справочник ошибок, не подразумевает существующие коды runtime.

`issues[].sourceKey` — ссылка на исходную запись внутри приватного пакета, потенциально идентифицирующая человека; её нельзя включать в публичные сообщения или Cloudflare trace. При `issues[].severity='error'` нельзя автоматически публиковать зависимый объект. Возможно сохранить валидные независимые данные для preview. Политика частичного импорта, confirmation и rollback не входит в MIG-04.

**Measures:** отдельные измерения тела не импортируются в этой версии, но `omittedData` отражает категорию, причину и количество, если оно достоверно известно. `count: null` означает «неизвестно», не ноль.

## 10. Идентичности, повторяемость и порядок

- Исходный `sourceKey` — стабильный ключ в пределах пакета; извлекается из достоверного ID с контекстом источника. При отсутствии ID допустим документированный детерминированный ключ по каноническому пути/устойчивым признакам; коллизии — явная ошибка, не silent merge.
- Повторное применение того же файла той же версии адаптера должно давать эквивалентный семантический пакет и одинаковые `sourceKey`/ссылки/позиции/issues. Служебное время обработки не влияет на содержимое.
- `inputSha256` относится к **неизменным исходным байтам**, а не к имени файла. Adapter version привязана к результату; иные версии не могут молча перезаписывать артефакты.
- Между файлами/клиентами одинаковые исходные ID не являются доказательством одной и той же личности или упражнения. Глобальный реестр сопоставления упражнений и логика дубликатов — **другой** этап.
- Не сортировать исторические сессии по подставленному временному слоту: точное исходное время и дата остаются в пакете. Детерминированная раскладка с 08:00, общий календарь тренера, возможное переполнение — в `MezfitImportPlan`.

## 11. Физические артефакты и MIG-03

Сегодня `migration/worker/processor/contracts.ts` определяет только транспортное `NormalizedPayload` (коллекции плоских скалярных записей). Действующий `result.json` по `results/<job-id>/v1/result.json` и synthetic fixture/nested schema v1/v2 — **не `SourceImportPackage`**.

Следующий MIG-04 реализует отдельную версию output contract / manifest, runtime validation и synthetic adapter, **не переписывая существующий result schema v1/v2**. Ограничения текущего processor `8192 bytes input / 1024 bytes result` и `256 records` несовместимы с реальными клиентскими архивами без нового архитектурного решения. Для больших источников допустим versioned manifest + проверенные bounded chunks в приватном R2; конкретный размер chunk и ключи/retention пока **не утверждены**. D1 хранит только техническую оркестрацию/ссылки/checksums, никогда содержимое тренировочной истории.

Текущий статический reviewed registry не запускает AI-generated код. Его возможное расширение — отдельный review-gated этап; это не причина менять данные контракта, утверждать Python/Yandex или давать сгенерированному коду доступ к Dexie.

### MIG-04: проверяемые сценарии будущей реализации

| Сценарий | Ожидаемое поведение |
| --- | --- |
| Источник: программа с фазой, днём, 2 упражнениями и 3 подходами | Создана только структура, без числового PROGRAM PLAN |
| Источник: программа без фаз | `phases=[]` и `phaseRef.none`; адаптер не изобретает фазу |
| Источник: числовые предписания внутри шаблона программы | Сохранены в `sourceAttributes`, выдан issue, не создан occurrence |
| Источник: плановая тренировка с числами | Числа только в `scheduledWorkouts[].plan` |
| Источник: выполненная тренировка со snapshot PLAN и отличающимся FACT | Frozen PLAN и FACT не смешаны; программа не мутирует |
| Источник: самостоятельная завершённая тренировка без времени | Валидны `programRef.none`, `frozenPlan.absent`, `precision=date` |
| Источник: неполная ссылка, `unknown`/`none` | Различаются; missing link остаётся issue, не создаётся объект |
| Источник: разные единицы или неизвестная единица | Сохраняется source unit, нет неявной конвертации |
| Источник: Measures/неизвестные атрибуты | Отчёт об исключениях, запрет копирования raw binary в JSON/trace |
| Источник: повторный запуск того же файла | Стабильные source keys, links, digests и issues |
| MIG-03 fixture/nested | Их текущие контракты и smoke остаются без регрессии |
| MIG-04 | Не создаёт Client identity, realm, `MezfitImportPlan`, пользовательские записи или право публикации |

## 12. Что не входит в этот контракт

- Алгоритмы Exercise Matching, пороги уверенности, создание упражнений, Flex schema/ACL и массовый remap — они потребляют `sourceExercises`.
- Жизненный цикл Imported Client → персональное приглашение → Clone & Rebind в канонический realm — следующий отдельный контракт (§15.4, §15.9 migration.md).
- Реконструкция нескольких исходных программ, конфликты с существующей активной программой, source sessions с неопределённой программной связью, авто-распределение времени, календарная проекция исторических Ad-hoc, обновление существующих бизнес-данных, partial commit.
- Выбор сервера/AI provider, генерация адаптеров и автоматическое исправление CI, привилегированный Dexie Cloud import API, retention PII и real-format support.

**Согласованное бизнес-правило будущего отображения:** завершённые импортированные сессии остаются `completed`, а маркер происхождения «Импортировано» определяется отдельно. `AdHocSessionRow.status` не принимает `imported`. Для source без программ Business Mapping Engine формирует одну активную программу с одной необходимой фазой и одним структурным днём из последней выполненной сессии, сохраняя **все** фактические сессии (включая последнюю) как историю; программа получает только структуру подходов.

**Критерий принятия этого документа:** любой adapter может вернуть один и тот же семантический `SourceImportPackage v1`, не зная таблиц/ACL Mezfit и не нарушая границу PROGRAM / OCCURRENCE / SESSION. Форматы реальных дампов и их полнота остаются отдельным предметом доказательной проверки.
