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

Админ-панель доступна на странице `admin.html`. Она позволяет менять порядок залов, редактировать названия, описания и метки, добавлять/удалять залы и управлять порядком фотографий.

Панель работает через тот же Cloudflare Worker, но по маршрутам `/admin/login` и `/admin/halls`, поэтому существующая форма бронирования продолжает отправлять заявки обычным `POST` на корневой endpoint.

Дополнительные секреты/переменные Worker для публикации в GitHub:

```bash
wrangler secret put ADMIN_PASSWORD
wrangler secret put GITHUB_TOKEN
wrangler secret put GITHUB_OWNER # опционально, по умолчанию n1kseeman
wrangler secret put GITHUB_REPO  # опционально, по умолчанию m-hall-minsk
wrangler secret put GITHUB_BRANCH # опционально, по умолчанию main
```

`GITHUB_TOKEN` должен иметь право обновлять содержимое репозитория. Загрузка новых фотографий сохраняет файлы в `assets/photos/`, а изменения залов — в `content/halls.json`.
