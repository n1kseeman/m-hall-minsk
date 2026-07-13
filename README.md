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
