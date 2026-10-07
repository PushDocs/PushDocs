# PushDocs MCP

PushDocs предоставляет remote MCP endpoint на адресе установки:

```text
https://docs.example.com/mcp
```

MCP работает через Streamable HTTP и OAuth Authorization Code с PKCE S256.
Git credentials остаются в PushDocs. Статические API keys не используются.

## Подготовка установки

Установите зависимости, выполните `yarn db:migrate` и перезапустите web и worker.
Установите `PUSHDOCS_PUBLIC_ORIGIN` в точный HTTPS origin установки.
Для разработки допускается HTTP на localhost.

Откройте Settings → MCP, чтобы увидеть endpoint и отозвать OAuth grants.
При подключении выберите проекты и разрешения. Доступ ограничен вашей текущей
ролью в каждом проекте. Grant действует не более 30 дней.

## Codex

```sh
codex mcp add pushdocs --url https://docs.example.com/mcp
```

Пройдите OAuth стандартным способом клиента. Не копируйте access tokens вручную.

## Claude Code

```sh
claude mcp add --transport http pushdocs https://docs.example.com/mcp
claude mcp login pushdocs
```

Авторизацию можно также открыть через `/mcp` в Claude Code. Войдите в PushDocs,
вернитесь к подключению при необходимости и выберите проекты на consent screen.

Сервер использует SDK 1.29.0 и поддерживает handshake MCP 2025-11-25.
Поддержка протокола 2026-07-28 не заявляется. Совместимость установленных версий
Codex и Claude Code требуется проверить перед выпуском.

## Примеры запросов

- Найди статьи про интеграции.
- Какие статьи ссылаются на docs/api/auth.md?
- Создай отдельную ветку, исправь статью и покажи изменения.
- Создай статью по шаблону, добавь её в sidebar после Webhooks.
- Проверь русскую и английскую орфографию, затем примени выбранные исправления.
- Покажи изображения статьи и оптимизируй выбранные файлы.
- Дай preview. Изменения пока не отправляй.
- Отправь просмотренный набор изменений и создай MR.

## Черновики и конфликты

Change set общий для всех пользователей ветки. MCP видит сохранённые черновики,
включая правки других пользователей. Создавайте отдельную ветку для задачи.
Новая ветка получает Git snapshot, а не черновики исходной ветки.

`get_branch_changes` показывает Git diff. `get_change_set` показывает ещё не
отправленные документы и assets. Просмотрите весь change set перед submission.

Для обновления передавайте `revisionToken` из `get_document` и текущий
`changeSetRevision` как `expectedRevision`. При `REVISION_CONFLICT` перечитайте
состояние и примените изменения к новой версии.

Каждый write call требует новый `idempotencyKey`. При потере ответа повторите
тот же ключ с теми же параметрами. Для новой операции используйте новый ключ.
Branch creation и submission возвращают operation ID. Опросите
`get_operation_status`, прежде чем переходить к зависимому действию.

## Поиск и навигация

Topic search использует lexical ranking. Он может пропускать статьи, если запрос
и документ не содержат общих терминов. Literal search ищет также в исходнике
frontmatter и code blocks. Результаты разбиваются на страницы.

Backlinks учитывают рабочие документы. Динамические и неоднозначные MDX-ссылки
возвращаются как unresolved. Repository JavaScript при анализе не выполняется.

Navigation tools поддерживают static JS object/array literals, экспортированные
через `module.exports` или `export default`, в том числе через переменную.
Форматирование вне изменяемого literal сохраняется; сам literal форматируется
заново. Dynamic JS и TypeScript configs возвращают unsupported error.

Получите sidebar через `get_navigation`, используйте возвращённые item IDs и
ревизию. Position принимает число, `first`, `last`, `{before: itemId}` либо
`{after: itemId}`. Удаление записи из sidebar сохраняет документ.

## Орфография и изображения

Проверка работает локально через nspell и Hunspell dictionaries. Лицензии:
MIT для nspell, MIT/BSD для dictionary-en и BSD-3-Clause для dictionary-ru.
Добавьте продуктовые слова в versioned файл:

```json
{"ignoredWords": ["PushDocs", "Sendsay", "саблогин", "webhook"]}
```

Путь файла: `.pushdocs/spelling.json`. Проверка пропускает код, URLs, imports,
MDX syntax и технические identifiers. Диапазоны corrections относятся к
исходному документу и требуют проверки его ревизии.

Image tools сохраняют формат, проверяют исходный hash и не заменяют файл,
если размер не уменьшился. Поддерживаются статические JPEG, PNG, WebP, AVIF
и безопасные статические SVG. Анимация и смена формата не поддерживаются.
Изменение общего asset влияет на все использующие его статьи.

## Preview

Существующие endpoints preview публичны и не проверяют OAuth или browser session.
Оператор должен явно принять эту модель и установить:

```sh
PUSHDOCS_MCP_ALLOW_PUBLIC_PREVIEW=1
```

Без настройки `start_preview` возвращает `PREVIEW_ACCESS_POLICY`.
Для приватной документации сначала требуется защитить публикацию preview.

Agent lease действует 30 минут. `start_preview` с новым idempotency key продлевает
его. `get_preview_status` не продлевает lease. `stop_preview` освобождает только
lease текущего OAuth grant. Browser leases продолжают работать независимо.

Ответ содержит `appliedSha`, `appliedRevision` и `contentCurrent`. Готовность
процесса не гарантирует применение последней сохранённой правки.

## Проверки

```sh
yarn test
yarn typecheck
yarn architecture:check
yarn build
```

Для интеграционного smoke test задайте `PUSHDOCS_TEST_DATABASE_URL` на отдельный
локальный PostgreSQL с правом создавать БД:

```sh
yarn test:mcp
```

Тест создаёт и удаляет случайную БД и использует настоящий MCP SDK client через
HTTP route. После `yarn build` можно также выполнить `PUSHDOCS_MCP_NETWORK_SMOKE=1 yarn test:mcp`: тест запустит standalone web application на временном HTTP-порту. Он не авторизуется в пользовательских accounts и не обращается
к production repositories. Ручная проверка обоих целевых клиентов остаётся
отдельным условием приёмки.
