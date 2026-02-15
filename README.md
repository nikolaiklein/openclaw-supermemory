# OpenClaw × Supermemory — Long-Term Memory for AI Agents

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-nikolaiklein%2Fopenclaw--supermemory-blue)](https://github.com/nikolaiklein/openclaw-supermemory)

Автоматическая синхронизация всех разговоров OpenClaw в [Supermemory](https://supermemory.ai) с мгновенным поиском по истории.

## What's New in v3.1

✅ **Environment Variable Configuration** — No more hardcoded values  
✅ **API Timeouts & Retry** — 30s timeout with exponential backoff  
✅ **Sensitive Data Scrubbing** — API keys won't leak in logs  
✅ **Stale PID Cleanup** — Automatic cleanup of orphaned PID files  
✅ **Race Condition Fix** — Graceful shutdown now preserves state correctly  

## Why Supermemory?

- **Sub-300ms поиск** — hybrid search (neural + keyword) по всей истории
- **Neural RAG** — Supermemory строит граф знаний, связывает факты, забывает устаревшее
- **Полная память** — каждое сообщение + файлы MEMORY.md автоматически попадают в Supermemory
- **Ноль токенов AI** — daemon работает как отдельный Node.js процесс
- **Дедупликация** — `customId` гарантирует отсутствие дублей при перезапуске
- **Автовоскрешение** — daemon поднимается через HEARTBEAT watchdog

## Архитектура

```
┌─────────────────┐     JSONL      ┌──────────────┐     REST API     ┌──────────────┐
│  OpenClaw        │ ───────────▶  │  Sync Daemon  │ ──────────────▶  │  Supermemory  │
│  (сессии)        │   файлы       │  (Node.js)    │   батчи          │  (cloud)      │
└─────────────────┘                └──────────────┘                  └──────────────┘
                                                                            │
┌─────────────────┐                ┌──────────────┐     search API          │
│  AI Agent        │ ◀──────────── │ recall script │ ◀──────────────────────┘
│  exec 1 команду  │   stdout      │  (Node.js)   │   результат <300ms
└─────────────────┘                └──────────────┘
```

## Быстрый старт

### 1. Получи API ключ

Зарегистрируйся на [supermemory.ai](https://supermemory.ai) и скопируй ключ (начинается с `sm_...`).

### 2. Добавь ключ в OpenClaw

В файле `~/.openclaw/agents/main/agent/auth-profiles.json` добавь в секцию `profiles`:

```json
"supermemory:default": {
  "type": "api_key",
  "provider": "supermemory",
  "apiKey": "sm_ТВОЙ_КЛЮЧ"
}
```

### 3. Клонируй репозиторий

```bash
cd /data/.openclaw/workspace
git clone https://github.com/nikolaiklein/openclaw-supermemory.git skills/supermemory
```

### 4. Установи зависимости

```bash
cd /data/.openclaw/workspace
npm install supermemory@4.11.1
```

### 5. Настрой переменные окружения

```bash
# Скопируй пример конфигурации
cp skills/supermemory/.env.example skills/supermemory/.env

# Отредактируй .env файл, установи свой CONTAINER_TAG
nano skills/supermemory/.env
```

**Обязательно установи `SM_CONTAINER_TAG`** — это твой уникальный идентификатор в Supermemory.

```bash
# Вариант 1: Через .env файл
echo 'SM_CONTAINER_TAG=my-unique-id' > skills/supermemory/.env

# Вариант 2: Через environment variable
export SM_CONTAINER_TAG=my-unique-id
```

### 6. Запусти

```bash
mkdir -p /data/.openclaw/workspace/memory

# Загрузи переменные окружения (если используешь .env)
export $(cat skills/supermemory/.env | xargs)

# Запуск daemon
bash skills/supermemory/scripts/sm-control.sh start

# Синхронизация файлов памяти
node skills/supermemory/scripts/sm-sync-files.js

# Тест поиска
node skills/supermemory/scripts/sm-recall.js recall "test"
```

## Конфигурация через Environment Variables

Все настройки теперь вынесены в переменные окружения:

| Переменная | Обязательная | По умолчанию | Описание |
|------------|--------------|--------------|----------|
| `SM_CONTAINER_TAG` | ✅ | — | Уникальный тег контейнера в Supermemory |
| `SM_AUTH_PATH` | ❌ | `/data/.openclaw/agents/main/agent/auth-profiles.json` | Путь к файлу с API ключом |
| `SM_BATCH_SIZE` | ❌ | `20` | Пар сообщений за батч |
| `SM_CHECK_INTERVAL_MS` | ❌ | `120000` | Интервал проверки (мс) |
| `SM_MIN_NEW_MESSAGES` | ❌ | `5` | Минимум сообщений для синхронизации |
| `SM_API_TIMEOUT_MS` | ❌ | `30000` | Таймаут API запроса (мс) |
| `SM_API_RETRY_ATTEMPTS` | ❌ | `3` | Количество попыток retry |
| `SM_API_RETRY_BASE_DELAY_MS` | ❌ | `1000` | Базовая задержка backoff (мс) |

> ⚠️ **Важно:** `SM_CONTAINER_TAG` теперь обязательная переменная. Скрипты не запустятся с placeholder значениями (`your-name`, `test`, и т.д.).

## Daemon v3.1

Текущая версия daemon (v3.1) синхронизирует:
- **Конверсации** — все JSONL сессии OpenClaw (автоматически, каждые 2 мин)
- **Файлы памяти** — MEMORY.md и daily notes через `sm-sync-files.js`

**Улучшения v3.1:**
- ⏱️ **Таймауты** — 30s timeout на все API вызовы (предотвращает зависание)
- 🔄 **Retry logic** — 3 попытки с exponential backoff при ошибках сети
- 🔒 **Scrubbing** — API ключи автоматически scrub из логов
- 🧹 **Stale PID** — PID файл автоматически чистится если процесс мёртв
- 🛑 **Graceful shutdown** — Исправлен race condition при сохранении state

## Управление daemon

```bash
bash skills/supermemory/scripts/sm-control.sh start     # Запустить
bash skills/supermemory/scripts/sm-control.sh stop      # Остановить
bash skills/supermemory/scripts/sm-control.sh restart   # Перезапустить
bash skills/supermemory/scripts/sm-control.sh status    # Статус
bash skills/supermemory/scripts/sm-control.sh logs      # Логи (live)
bash skills/supermemory/scripts/sm-control.sh check     # Проверка для heartbeat (silent)
```

## Поиск по памяти

```bash
# Поиск по запросу
node skills/supermemory/scripts/sm-recall.js recall "что обсуждали про маркетинг"

# Профиль (все известные факты)
node skills/supermemory/scripts/sm-recall.js profile
```

## Автозапуск при рестарте контейнера

Добавь в `HEARTBEAT.md`:

```markdown
## Daemon watchdog
- Check sm-daemon: `bash skills/supermemory/scripts/sm-control.sh check`
- If not running: `bash skills/supermemory/scripts/sm-control.sh start`
```

## Структура проекта

```
skills/supermemory/
├── .env.example             — пример конфигурации environment variables
├── SKILL.md                 — инструкция для AI агента (когда/как вызывать recall)
└── scripts/
    ├── sm-recall.js         — поиск по памяти
    ├── sm-sync-files.js     — синхронизация MEMORY.md + daily notes
    ├── sm-daemon.js         — фоновый daemon автосинхронизации
    └── sm-control.sh        — управление daemon: start/stop/restart/status/logs
```

## Требования

- Node.js 18+
- [OpenClaw](https://github.com/hostinger/openclaw)
- [Supermemory](https://supermemory.ai) аккаунт (бесплатный план — 2000 документов)
- `supermemory` npm пакет v4.11.1

## Лицензия

MIT

## Миграция с v3.0

Если вы использовали v3.0:

1. Установите `SM_CONTAINER_TAG` в environment variable:
   ```bash
   export SM_CONTAINER_TAG=your-name  # замените на свой идентификатор
   ```

2. Все остальные настройки имеют значения по умолчанию, обратная совместимость сохранена.

3. Старый hardcoded `CONTAINER_TAG` больше не используется — обязательно задайте env var.
