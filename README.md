# M HALL Minsk

Статический сайт банкетного зала M HALL в Минске. Структура близка к проекту RICH HALL: главная страница, отдельная страница меню, JSON-контент для залов и меню, форма заявки и галерея.

## Локальный запуск

```bash
python3 -m http.server 4173
```

После запуска сайт доступен по адресу `http://localhost:4173`.

## Публикация

Сайт публикуется через GitHub Pages из корня ветки `main`.

## Telegram-заявки

Форма на сайте отправляет заявку на backend endpoint из атрибута `data-form-endpoint` в `index.html`.
Для Telegram используется Cloudflare Worker `worker/telegram-booking-worker.js`.

Нужные секреты Worker:

```bash
npm install
npm run worker:secret:token
npm run worker:secret:chat
npm run worker:deploy
```

После деплоя Worker нужно вставить его URL в `data-form-endpoint`.

## Структура

- `index.html` - главная страница;
- `menu.html` - банкетное меню;
- `assets/styles.css` - общий стиль сайта;
- `assets/site.js` - навигация, форма, галерея;
- `assets/halls-site.js` - загрузка залов из `content/halls.json`;
- `assets/menu-site.js` - загрузка меню из `content/menu.json`;
- `content/halls.json` - контент залов и зон;
- `content/menu.json` - контент меню;
- `worker/telegram-booking-worker.js` - endpoint для отправки заявок в Telegram.

## Что подключить перед боевым запуском

- URL задеплоенного Worker в `data-form-endpoint`;
- телефон, если он нужен на сайте;
- финальные юридические данные для футера или политики.

## Административная панель

Админ-панель доступна на странице `/admin/` (`admin.html` оставлен редиректом для совместимости). Она позволяет менять порядок залов, редактировать названия, описания и метки, добавлять/удалять залы и управлять порядком фотографий.

Панель перенесена по структуре RICH HALL и работает через тот же Cloudflare Worker по маршрутам `/api/login`, `/api/session` и `/api/publish`; совместимость со старыми `/admin/*` маршрутами сохранена. Существующая форма бронирования продолжает отправлять заявки обычным `POST` на корневой endpoint.

Чтобы админка полностью заработала после merge/deploy:

1. Создайте GitHub fine-grained token с доступом `Contents: Read and write` к этому репозиторию.
2. Доступ в админку по умолчанию: логин `admin`, пароль `Mhall-7429`. При необходимости их можно переопределить секретами `ADMIN_USERNAME` и `ADMIN_PASSWORD_HASH`.
3. Добавьте секреты/переменные Worker для публикации в GitHub:

```bash
wrangler secret put GITHUB_TOKEN
wrangler secret put GITHUB_OWNER # опционально, по умолчанию n1kseeman
wrangler secret put GITHUB_REPO  # опционально, по умолчанию m-hall-minsk
wrangler secret put GITHUB_BRANCH # опционально, по умолчанию main
wrangler secret put ADMIN_USERNAME # опционально, по умолчанию admin
wrangler secret put ADMIN_PASSWORD_HASH # опционально, SHA-256 хеш пароля Mhall-7429
wrangler secret put SESSION_SECRET # опционально, секрет подписи сессии
```

`GITHUB_TOKEN` должен иметь право обновлять содержимое репозитория. Загрузка новых фотографий сохраняет файлы в `assets/photos/`, а изменения залов — в `content/halls.json`.

4. Задеплойте Worker командой `npm run worker:deploy`.
5. Проверьте URL Worker в `admin/config.js`, затем откройте `https://mhall.by/admin/` или GitHub Pages URL `/admin/`, введите логин `admin` и пароль `Mhall-7429`.
6. После нажатия «Сохранить в GitHub» дождитесь обновления GitHub Pages; форма бронирования продолжит работать через обычный `POST` на тот же Worker.


### Запуск без локальной копии проекта

Если проект есть только на GitHub, Worker можно деплоить через GitHub Actions:

1. В GitHub создайте fine-grained token для этого репозитория с правом `Contents: Read and write`.
2. В Cloudflare создайте API token с правом деплоя Workers и скопируйте Account ID.
3. В GitHub откройте `Settings` → `Secrets and variables` → `Actions` → `New repository secret` и добавьте:
   - `CLOUDFLARE_API_TOKEN` — Cloudflare API token;
   - `CLOUDFLARE_ACCOUNT_ID` — Cloudflare Account ID;
   - `WORKER_GITHUB_TOKEN` — GitHub token из шага 1;
   - `ADMIN_USERNAME` — опционально, если нужно заменить `admin`;
   - `ADMIN_PASSWORD` — опционально, если нужно заменить `Mhall-7429` в GitHub Actions; workflow сам передаст в Worker SHA-256 хеш.
   - `SESSION_SECRET` — опционально, секрет подписи сессии.
4. В GitHub откройте `Actions` → `Deploy Cloudflare Worker` → `Run workflow`.
5. После успешного workflow откройте `https://mhall.by/admin/`, введите логин `admin` и пароль `Mhall-7429`.
