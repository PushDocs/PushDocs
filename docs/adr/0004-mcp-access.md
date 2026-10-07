# MCP доступ к PushDocs

Статус: принято 7 октября 2026 года.

PushDocs предоставляет `/mcp` через существующий web application. Codex и
Claude Code используют одинаковый API. Transport реализован официальным SDK
1.29.0 в stateless HTTP mode с поддержкой MCP 2025-11-25.

OAuth grants представляют существующих пользователей, ограничивают scopes
и фиксируют выбранные проекты. Project permissions проверяются при вызове и
перед внешней записью worker. Tokens хранятся в виде hashes. Отзыв grant и
изменение учётных данных прекращают доступ.

MCP использует общий change set ветки. Для отдельной задачи рекомендуется
отдельная ветка. Новые ветки создаются от точного Git SHA без переноса черновиков.
Записи проверяют ревизии и используют общий application service. Внешнее изменение
документа согласуется с epoch совместного редактора.

Write calls используют durable idempotency keys. Результат и изменения БД
сохраняются атомарно. Git submission продолжает существующий prepared-commit flow.

MCP agent получает отдельную preview lease на 30 минут. Существующие публичные
preview endpoints требуют явного включения оператором для MCP. Защита публикации
preview не подменяется OAuth-защитой MCP endpoint.

Поиск по теме сначала использует lexical ranking. Navigation разбирается как
static literals. Repository JavaScript не выполняется для этих операций.

План и условия приёмки находятся в `docs/mcp-plan.md`, инструкция подключения
находится в `docs/mcp.md`.
