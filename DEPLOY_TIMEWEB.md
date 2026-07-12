# Развертывание на сервере

Эта памятка нужна для первого запуска проекта на удаленном сервере, например на Timeweb Cloud VPS.

## Что выбрать на сервере

Рекомендуемый вариант для первой рабочей версии:

- Ubuntu 24.04 LTS или Ubuntu 22.04 LTS
- 1-2 CPU
- 2 GB RAM
- 20-30 GB SSD
- ежедневный бэкап сервера или отдельный бэкап файла базы SQLite

## Что важно знать

Проект использует SQLite. Это значит, что рабочая база будет обычным файлом на сервере.

Файл базы не хранится в GitHub. GitHub хранит код приложения, а данные должны жить на сервере и регулярно копироваться в бэкап.

## Команды первого запуска

На сервере нужно установить Node.js LTS, затем выполнить:

```bash
git clone https://github.com/SegaMega-kch/quarry-rope-tracker.git
cd quarry-rope-tracker
cp .env.example .env
npm ci
npm run db:push
npm run db:seed
npm run build
npm run start
```

В файле `.env` для SQLite обычно достаточно:

```env
DATABASE_URL="file:./dev.db"
AUTH_SECRET="replace-me-with-long-random-text"
```

После `npm run db:seed` создаются начальные пользователи. Временный пароль: `123456`.

## Постоянный запуск

Для постоянной работы лучше запускать приложение через `pm2`:

```bash
npm install -g pm2
pm2 start npm --name quarry-rope-tracker -- run start
pm2 save
pm2 startup
```

## Обновление проекта

Когда новая версия отправлена в GitHub:

```bash
git pull
npm ci
npm run db:push
npm run build
pm2 restart quarry-rope-tracker
```

## Бэкап данных

Минимально важный бэкап - файл базы SQLite:

```bash
cp prisma/dev.db backups/dev-$(date +%F-%H-%M).db
```

Лучше настроить автоматический ежедневный бэкап через панель Timeweb или отдельную команду `cron`.
