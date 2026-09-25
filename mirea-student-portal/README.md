# MIREA Student Portal

Учебное веб-приложение для практической работы №2. Портал для группы
ИВБО-22-23 с тремя разделами: расписание, ближайшие занятия, дедлайны.

## Архитектура

```
                 ┌────────────┐
   Пользователь →│   Nginx    │→ статический frontend (HTML/CSS/JS)
                 │ (порт 80)  │
                 └─────┬──────┘
                       │ /api/*  (round-robin балансировка)
              ┌────────┴────────┐
              ▼                 ▼
        backend-1:8000    backend-2:8000
        (FastAPI)          (FastAPI)
              │                 │
              └───────┬─────────┘
                       ▼
          ./backend/data (общий bind mount)
          schedule.json + deadlines.json
```

Каждый backend получает свой `INSTANCE_ID` через переменную окружения
и возвращает его в заголовке `X-Backend-Instance` и в теле JSON-ответа —
это видно на фронтенде в правом верхнем углу ("узел: backend-1" /
"узел: backend-2"), и так однозначно определяется, какая нода ответила.

Оба backend-контейнера читают и пишут одни и те же JSON-файлы через
общий bind mount с хоста, поэтому падение одной ноды не создаёт проблем
с доступом к данным — вторая нода продолжает работать с тем же файлом.

## Запуск

```bash
git clone <ссылка-на-репозиторий>
cd mirea-student-portal
docker compose up -d --build
```

Приложение будет доступно на `http://localhost` (или по Tailscale-адресу
хоста — `http://100.x.x.x`).

## Проверка балансировки

```bash
curl -s http://localhost/api/instance
curl -s http://localhost/api/instance
curl -s http://localhost/api/instance
```

В ответах должен чередоваться `instance_id`: `backend-1`, `backend-2`, ...

## Проверка отказоустойчивости

```bash
docker stop mirea-backend-1
curl -s http://localhost/api/instance   # должен ответить backend-2
```

Приложение продолжает работать, данные не теряются — они лежат на диске
хоста, а не внутри контейнера.

## Структура проекта

```
mirea-student-portal/
├── backend/
│   ├── main.py            — FastAPI-приложение, все эндпоинты /api/*
│   ├── requirements.txt
│   ├── Dockerfile
│   └── data/
│       ├── schedule.json  — расписание группы (с учётом чётности недели)
│       └── deadlines.json — дедлайны по дисциплинам, флаг done true/false
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── script.js
├── nginx/
│   └── nginx.conf          — reverse proxy + балансировка
├── docker-compose.yml
└── README.md
```

## API

| Метод | Путь                          | Описание                                  |
|-------|-------------------------------|--------------------------------------------|
| GET   | `/api/instance`               | ID ноды и текущее время сервера            |
| GET   | `/api/schedule`                | Полное расписание группы                   |
| GET   | `/api/upcoming`                | Ближайшие занятия (с учётом текущей даты)  |
| GET   | `/api/deadlines`               | Список дедлайнов по дисциплинам            |
| POST  | `/api/deadlines/{id}/toggle`   | Переключить статус "выполнено"             |
| GET   | `/api/health`                  | Проверка живости ноды                      |

## Ограничения по заданию ПР№2

- TLS/SSL приложение не обрабатывает — это задача Nginx/Apache на
  следующем этапе (ЛР№3).
- Сессии пользователей не используются — портал без авторизации.
- Хранилище (JSON) — на общем bind mount, не внутри контейнера.
