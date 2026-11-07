# COMM-05: интерфейс одной ветки

Задача: [#640](https://github.com/buropotok/mezfit/issues/640).
Фундамент: [DiscussionRepository](discussions-repository.md), COMM-04 / PR #658.

## Граница и подключение

`src/discussions/index.ts` экспортирует `DiscussionSheet` и его typed props.
Вызывающий экран передаёт существующий account-owned `DiscussionRepository`,
`threadId`, canonical `anchor`, необязательный `focusMessageId`, `opened`, `onClose`,
`resolveAuthor`, `parentNavigation` и штатный `onNavigationContextChange` shell.
`resolveAuthor` использует уже доступные профили/аватары; sheet не загружает их по HTTP.
`parentNavigation` — стабильный snapshot контекста исходной сущности либо null.
Callback shell тоже должен быть стабильным. Пока sheet открыт, его callback Back
поочерёдно закрывает confirm, меню, режим composer, затем sheet; cleanup возвращает
ровно переданный parent. Переходить к другой сущности при закрытии не нужно.

Вход из push сначала разрешает точный anchor под существующим navigation owner,
потом передаёт sheet тот же thread/focus. Sheet не создаёт ветку, не заменяет source ID
и не реализует ещё один Telegram/browser-history handler. Исчезнувший источник
может сохранить разрешённую историю: header использует repository title snapshot.
Не найденный thread в данном anchor и недоступное сообщение дают безопасную ошибку.

В COMM-05 нет входов из меню сущностей, inbox, регистрации push или новой navigation
системы. Это интеграции COMM-06/07/08/12. Компонент не монтируется массово и не меняет
account factory/provider: schema v16 по-прежнему только opt-in после реальных ACL checks.
Нельзя включать опцию на другом экземпляре той же account DB лишь ради открытия UI:
весь lifecycle аккаунта должен использовать согласованную версию схемы.
Schema/ACL Apply, membership, PLAN/FACT и business repository CRUD не меняются.

## UI и одобренное расширение

Используются Konsta 5.4.0 `Messages`, `MessagesTitle`, `Messagebar` и штатные
Mezfit BottomSheet/Dialog/LiquidPopover в iOS dark окружении приложения.
Фиксированный Messagebar сохраняет native renderer и размеры: поле не превращается
в новый auto-grow control. Его публичный root ref измеряет место, резервируемое
в собственном scroll-контейнере sheet; контекст reply/edit расположен над ним.
`visualViewport` resize/scroll и window resize меняют только публичные layout props
BottomSheet и отписываются при unmount. Safe areas остаются у штатных Sheet/Toolbar.

Владелец отдельно согласовал узкий `src/ui/konsta-mezfit/Message.tsx` перед реализацией.
У публичного Konsta Message ref указывает на всю строку, а bubbleRef/слота source нет.
Адаптер сохраняет его 5.4 renderer, классы, цвета и 70% ограничение, предоставляя
только `bubbleRef`, `onBubbleClick`, `bubbleSource`. Renderer-capable name/textHeader/
textFooter типизированы как ReactNode (в upstream declarations они string).
Сравнительный тест проверяет фактическую разметку адаптера и native Message.
Файлы установленного Konsta не меняются. Feature-код не обращается к private DOM/CSS.

LiquidPopover получает прозрачный неинтерактивный круг 4×4 в центре bubble и актуальные
`preset/optics/blur` из переданных GlassSettings либо существующего browser settings.
Источник находится внутри bubble; его координаты автоматически следуют layout/scroll.
Меню одно. Его portal-события останавливаются в собственном composition wrapper,
чтобы действие/backdrop не открывали bubble menu повторно.
Tabler `arrow-back-up` добавлен в общий реестр; edit/copy/trash переиспользуются.

Ответ использует repository `replyToMessageId`; отображаемая quote — текущая проекция,
не отдельная сохранённая копия. Заголовок автора и первая строка с CSS ellipsis
принадлежат контенту Mezfit. Tombstone/недоступность не показывают прежний текст.
Edit работает в том же composer, remove — после штатного confirm; copy читает полный
доступный текст через repository и использует Clipboard API с честной ошибкой отказа.
Для будущих медиа есть `renderAttachment`, сейчас без загрузки, confirm или storage URLs.

## Жизненный цикл и история

`DiscussionSession` — application owner живых UI-проекций, не бизнес-хранилище и не
SyncEngine. Он использует только public repository methods. Каждая страница имеет
свою subscribe/unsubscribe; при сдвиге курсора пересоздаются зависимые страницы,
в том числе ещё не завершившие первую загрузку. Закрытие/смена repository/target
отменяют старые результаты. Locate сверяет exact message через getMessage, подгружает
нужные страницы через observePage и подтверждает успех только при наличии точного ID
в актуальной live-проекции. Нет повторного сканирования тех же страниц отдельно от observer. UI прокручивает только
собственный scroll owner и ненадолго подсвечивает собственную оболочку строки.

Подгрузка вверх сохраняет позицию по разнице scrollHeight. Новые сообщения ведут
к концу только когда читатель уже был у конца. При старом focus target автоматического
прочтения всей новой истории нет; markRead вызывается у конца для чужих сообщений.
Send retry сохраняет подготовленную команду с тем же ID; двойной submit блокируется
владельцем операции. Локальный успех независим от sync status/error/retry готового
COMM-04 helper. Нового transport/очереди или фоновых HTTP из React нет.

## Проверки и ограничения

Новые тесты: состав/порядок tap menu и иконки, материал, источник в bubble, reply/edit/
copy/remove/cancel/retry, старый focus/quote и tombstone, pagination при новых сообщениях,
query failure, устаревшие результаты и unsubscribe, Back и восстановление сущности,
viewport keyboard iPhone/Android, удержание scroll и follow-at-end, CSS center/ellipsis,
сравнение с native renderer. Существующие тесты не меняются.

Локальные npm/typecheck/test/build не запускаются согласно процессу; CI после PR.
Тесты viewport/событий — моделирование, не физическая приёмка WebView. Настоящие
iOS/Android keyboard/scroll/Clipboard/animation и обычные Coach/Client ACL, offline
двух устройств остаются отдельной приёмкой до массовой активации.

При полном ревью после первого CI дополнены typed declarations внутренних Message
helpers в существующей границе адаптеров; неподдерживаемые Button strong и ios/material
удалены из этого пути. Исправлены ожидание live target при гонке страниц, сохранение
истории при смене курсоров, изоляция ошибок страниц, Edit→Reply, сохранение текста при
отмене reply через Back, markRead после visibility resume и группировка локальных дат.
Добавлены соответствующие регрессионные тесты. Это source review, не заявление об успехе CI.

Релевантны audit A-003 (Back/navigation), A-005 (гонки async), A-008 (границы UIkit),
A-009 (восстановление после ошибки). Перед PR требуется решение владельца по процессу.

## Исправления системного ревью COMM-01–05

Живая история сохраняет нижнюю границу уже раскрытых страниц, а не только их
количество. При сдвиге курсоров подгружаются дополнительные страницы до этой
границы; отображаются актуальные repository rows, включая tombstones. UI сохраняет
видимую строку и её смещение внутри собственного scroll owner, когда читатель
находится вне конца.

Реальный DiscussionRepository предоставляет getDraft/saveDraft. Composer читает
приватный черновик по ветке при открытии и сразу ставит локальное сохранение
каждого изменения текста/reply перед последующим send или закрытием. Ошибки
восстановления блокируют ввод до retry; ошибки сохранения показываются с retry.
Закрытие отменяет только UI completion, уже начатые локальные записи завершаются.
Редактирование отправленной реплики не переписывает отдельный неотправленный
черновик. После успешной отправки composer очищается, ID для retry сохраняется.
Публичный DiscussionPort требует draft API существующего repository;
отдельного UI-хранилища или необязательного режима без persistence нет.

Новые регрессии покрывают точную границу 80→81, входящий burst, retry и live delete,
закрытие/восстановление текста/reply/ID, ошибку восстановления и удержание scroll.
Физическая приёмка Telegram iOS/Android и прочие rollout gates остаются обязательными.

Уточнение после review PR #662: переход Edit→Reply сохраняет отдельный текст
черновика, а не временный текст редактирования. Если сохранение обнаружило, что
ID уже опубликован с другого устройства, composer сохраняет последние изменения
под новым ID. Запоздалые отказы старого ID не меняют этот новый черновик. При
гонке публикации непосредственно перед Send текст не очищается; после локального
сохранения нового черновика пользователь может повторить отправку.
