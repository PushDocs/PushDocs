# Обновление Caddy

Изменение образа Caddy подготовлено для ревью. Публикация PR не обновляет сервер.
Приложение и PostgreSQL этим изменением не обновляются.

## Caddy

Compose закрепляет выпущенный `caddy:2.11.9-alpine` по digest
`sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0`.
В индексе есть Linux amd64 для production и arm64 для локальных проверок.
Исправленный образ содержит обновлённые Go и x/net HTTP/2-парсеры.

Первичные уведомления: https://pkg.go.dev/vuln/GO-2026-6603,
https://pkg.go.dev/vuln/GO-2026-6611, https://pkg.go.dev/vuln/GO-2026-6612,
https://pkg.go.dev/vuln/GO-2026-6617.

После отдельно разрешённого rollout проверить `caddy version`, digest работающего
контейнера, HTTPS login и `/api/health`, HTTP/2 и существующие preview-маршруты.
Не считать успешную сборку или mutable tag доказательством rollout.
Сохранить предыдущий digest и установленный Compose для согласованного отката;
обычный rollback не должен незаметно возвращать уязвимый proxy.
