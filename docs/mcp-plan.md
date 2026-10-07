# План MCP в PushDocs

Обновлено 7 октября 2026 года. Обязательные клиенты: Codex и Claude Code.

## Цель

Пользователь подключает PushDocs через OAuth, находит документацию, создаёт ветку,
изменяет документы и связанные файлы, проверяет preview и по явному запросу
отправляет общий change set в GitHub PR или GitLab MR.

## Архитектура

MCP работает на `/mcp` внутри существующего web application. Handler проверяет
OAuth, scopes и grant, затем вызывает общий ProjectService. Service использует
существующие repository, provider adapters, worker, drafts и preview runner.

Правила редактирования файлов общие для UI и MCP. Git credentials не покидают
PushDocs. MCP не выполняет repository JavaScript. Dynamic sidebar configs
возвращают `UNSUPPORTED_NAVIGATION_FORMAT`.

## Состояние и конкурирующие изменения

Рабочее состояние включает импортированный Git SHA, общие сохранённые черновики
ветки и готовые вложения. Несохранённый текст браузера в него не входит.

Ответы возвращают `headCommitSha`, `changeSetId`, `changeSetRevision`. Документ
дополнительно возвращает `revisionToken`. Запись требует ожидаемой ревизии,
а обновление документа также требует token. Внешнее обновление согласуется
с editing epoch существующего совместного редактора.

Создание ветки использует проверенный Git SHA и не переносит черновики исходной
ветки. `get_branch_changes` показывает Git diff. `get_change_set` показывает
неотправленные изменения, включая правки других пользователей и attachments.

Submission принимает конкретные change set и revision. Изменение набора после
просмотра приводит к конфликту.

## OAuth

Используется Authorization Code с PKCE S256 и public clients. Первый механизм
регистрации: DCR. Metadata documents указывают registration endpoint. CIMD может
быть добавлен отдельно, если потребуется целевым клиентам.

Authorization codes одноразовые. Access tokens живут 15 минут. Refresh tokens
ротируются, повторное использование отзывает grant. Grant ограничен 30 днями.
Tokens хранятся в виде hashes. Grant фиксирует выбранные пользователем проекты,
scopes и состояние учётных данных. Смена пароля/2FA прекращает его действие.

Endpoints:

- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-authorization-server`
- `/oauth/register`
- `/oauth/authorize`
- `/oauth/token`
- `/oauth/revoke`

Consent показывает клиент, scopes и проекты. Отзыв доступен в Settings → MCP.
Проверяются resource, issuer, redirect URI, Origin и текущие project permissions.
Worker повторно проверяет OAuth grant перед внешними изменениями.

Scopes: `pushdocs:read`, `pushdocs:write`, `pushdocs:preview`, `pushdocs:submit`.
Scope не повышает роль пользователя. Новые проекты автоматически не добавляются.

## Transport и клиенты

Начальный transport: stateless Streamable HTTP через официальный TypeScript SDK
1.29.0. Поддерживаются версии, предоставляемые этим SDK, включая handshake
`2025-11-25`. Сервер не заявляет поддержку нового flow `2026-07-28`.

Codex и Claude Code используют один endpoint и одинаковые tools. Для выпуска
обязательны отдельные ручные проверки целевых версий обоих клиентов.
Интеграционные тесты SDK не заменяют такие проверки. Пользователь самостоятельно
проходит клиентскую OAuth-авторизацию.

## Операции и аудит

Долгие Git-операции возвращают `operationId`. Клиент опрашивает
`get_operation_status`. Все write tools требуют `idempotencyKey`.

Результат write call и изменение БД сохраняются в одной транзакции. Повтор ключа
возвращает прежний результат. Другие параметры с тем же ключом отклоняются.
Рабочие Git retries используют существующий prepared-commit journal.

Audit хранит пользователя через grant, OAuth client, tool, project, branch,
затронутые пути, результат и время. Содержимое документов и credentials в audit
не записываются. Вводятся durable rate limits.

## Tools

Чтение: `list_projects`, `get_project`, `list_branches`, `list_documents`,
`get_document`, `get_change_set`, `get_branch_changes`, `get_operation_status`.

Документы: `create_branch`, `create_document`, `update_document`,
`plan_document_template`, `apply_document_template`.

Поиск: `search_documents`, `find_documents_by_topic`, `get_document_backlinks`.
Первый вариант topic search использует lexical ranking и явно сообщает об
ограничении семантической полноты. Индекс links учитывает черновики и использует
ограниченный cache. Динамические ссылки остаются unresolved.

Навигация: `get_navigation`, `add_document_to_navigation`, `move_navigation_item`,
`remove_navigation_item`. Поддерживаются static JS literals без выполнения кода.
Идентификаторы узлов действуют для возвращённой ревизии. Позиции: first, last,
index, before и after. Удаление записи не удаляет документ.

Качество: `check_spelling`, `fix_spelling`, `list_document_images`,
`compress_image`, `compress_document_images`. Проверка орфографии работает
локально для русского и английского. Corrections требуют исходную ревизию.
Project dictionary хранится в `.pushdocs/spelling.json`.

Изображения оптимизируются через media staging. Замена требует исходный hash.
Оригинал сохраняется при отсутствии выигрыша. Анимация отклоняется. Изменение
формата в первой версии не поддерживается, поэтому обновление ссылок не требуется.
Batch optimization принимает явно просмотренные paths и hashes.

Preview: `start_preview`, `get_preview_status`, `stop_preview`. Agent lease
принадлежит OAuth grant и живёт 30 минут. Повторный start с новым ключом продлевает
lease. Stop освобождает только lease вызывающего grant. Ответ разделяет готовность
процесса и соответствие SHA/revision.

Текущие preview endpoints публичны. MCP start по умолчанию запрещён, пока оператор
явно не включит `PUSHDOCS_MCP_ALLOW_PUBLIC_PREVIEW=1`. Защищённая публикация preview
является отдельным изменением существующего runner/proxy.

Submission: `submit_changes` с режимами push_only/create_review. Target branch,
review title и description передаются существующему worker. Частичный успех push
и review обрабатывается отдельно. CI preview не объявляется готовым без проверки
соответствующего SHA.

## Этапы и приёмка

1. Зафиксировать state/revision contracts и общие проверки файлов.
2. Реализовать OAuth, consent/revoke, transport и read tools.
3. Проверить подключение SDK, затем целевых Codex и Claude Code.
4. Реализовать полный путь branch → edit → diff → preview.
5. Подключить submission и проверить retries без повторных commits/reviews.
6. Добавить поиск, backlinks, navigation, spelling и оптимизацию assets.
7. Проверить безопасность, сборку, документацию и установку.

Tests добавляются вместе с функциональностью. PostgreSQL и Git tests используют
только отдельные локальные fixtures. Запрещены push в production repositories.

Критические сценарии: revoked/expired tokens, PKCE, refresh reuse, scopes,
Reader writes, потеря роли перед job, одновременный UI/MCP edit, stale revision,
повтор write call, template atomicity, изменившиеся backlinks, unsupported sidebar,
изменившийся asset hash, preview leases и submission после частичного успеха.

## Критерий завершения

Оба клиента подключаются через OAuth и проходят полный диалог поиска,
редактирования, preview и явного submission. Изменения видны в PushDocs UI.
Нет тихих перезаписей, дублирующихся операций и выдачи provider credentials.
Результаты автоматических проверок и оставшиеся ограничения записаны отдельно.

## Состояние реализации

Реализованы OAuth/DCR/consent/revoke, HTTP transport, Settings → MCP, discovery,
чтение и запись документов, template plan/apply, поиск и backlinks, статическая
навигация, орфография, оптимизация изображений, agent preview leases и submission
через существующий worker. Добавлена миграция `017-mcp-oauth`.

Статус операции разделяет отправленный commit и текущий SHA ветки. CI preview
возвращается только при совпадении SHA review с отправленным commit и успешном
`preview:deploy`; URL берётся из существующего `PUSHDOCS_PREVIEW_URL`.

Автоматическая приёмка включает общий `yarn check`, PostgreSQL security/recovery
suites и MCP SDK integration suite. Дополнительный smoke test запускает production
standalone application на временном TCP-порту. Проверяются в том числе concurrent
idempotency replay, отклонение чужого resource и stale CI preview.

Перед выпуском остаются эксплуатационные шаги:

- Применить миграции и перезапустить web/worker на целевой установке.
- Проверить HTTPS origin и настройки reverse proxy.
- Самостоятельно пройти OAuth в установленных Codex и Claude Code и выполнить
  полный диалог приёмки, включая preview и PR/MR в тестовом репозитории.
- Для публичного preview явно включить настройку оператора. Для приватного preview
  сначала реализовать защиту существующего preview proxy.

Деплой и пользовательская авторизация не выполнялись в рамках реализации.

### Результаты локальной проверки 7 октября 2026

- `yarn check`: успешно. Lint/format/architecture/typecheck пройдены, 1051 общих
  тестов пройдены, production build всех 13 packages успешен. В lint остаются
  6 предупреждений в ранее существовавших файлах. 11 MCP tests пропускаются в
  общем прогоне без отдельной тестовой PostgreSQL.
- `PUSHDOCS_MCP_NETWORK_SMOKE=1 yarn test:mcp` с отдельной PostgreSQL: 11 из 11
  тестов пройдены, включая настоящий HTTP-порт standalone production build.
- `yarn test:security` с отдельной PostgreSQL: успешно, включая upgrade migrations,
  одноразовые приглашения, TOTP replay, отзыв sessions и persistent limits.
- `yarn test:integration` с отдельной PostgreSQL: успешно, включая prepared commit
  recovery, отдельный retry review, точные Git bytes, отсутствие duplicate commit,
  межсоединительный ref lock, upload limit и optimistic write race.
- `git diff --check`: успешно.

Использовались случайные временные БД локального PostgreSQL. Рабочая БД сервиса
и реальные пользовательские OAuth sessions не изменялись.
