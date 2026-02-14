# OpenClaw × Supermemory — Long-Term Memory for AI Agents

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-Aiwariur%2Fopenclaw--supermemory-blue)](https://github.com/Aiwariur/openclaw-supermemory)

Автоматическая синхронизация всех разговоров OpenClaw в [Supermemory](https://supermemory.ai) с мгновенным поиском по истории.

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
git clone https://github.com/Aiwariur/openclaw-supermemory.git skills/supermemory
```

### 4. Установи зависимости

```bash
cd /data/.openclaw/workspace
npm install supermemory@4.11.1
```

### 5. Запусти

```bash
mkdir -p /data/.openclaw/workspace/memory

# Запуск daemon
bash skills/supermemory/scripts/sm-control.sh start

# Синхронизация файлов памяти
node skills/supermemory/scripts/sm-sync-files.js

# Тест поиска
node skills/supermemory/scripts/sm-recall.js recall "test"
```

## Daemon v3.0

Текущая версия daemon (v3.0) синхронизирует:
- **Конверсации** — все JSONL сессии OpenClaw (автоматически, каждые 2 мин)
- **Файлы памяти** — MEMORY.md и daily notes через `sm-sync-files.js`

> v2.0 синхронизировал только конверсации. v3.0 добавил автоматическую синхронизацию MEMORY.md.

## Структура проекта

```
skills/supermemory/
├── SKILL.md                 — инструкция для AI агента (когда/как вызывать recall)
└── scripts/
    ├── sm-recall.js         — поиск по памяти
    ├── sm-sync-files.js     — синхронизация MEMORY.md + daily notes
    ├── sm-daemon.js         — фоновый daemon автосинхронизации
    └── sm-control.sh        — управление daemon: start/stop/restart/status/logs
```

## Управление daemon

```bash
bash skills/supermemory/scripts/sm-control.sh start     # Запустить
bash skills/supermemory/scripts/sm-control.sh stop      # Остановить
bash skills/supermemory/scripts/sm-control.sh restart   # Перезапустить
bash skills/supermemory/scripts/sm-control.sh status    # Статус
bash skills/supermemory/scripts/sm-control.sh logs      # Логи (live)
```

## Поиск по памяти

```bash
# Поиск по запросу
node skills/supermemory/scripts/sm-recall.js recall "что обсуждали про маркетинг"

# Профиль (все известные факты)
node skills/supermemory/scripts/sm-recall.js profile
```

## Конфигурация daemon

| Параметр | Значение | Описание |
|---|---|---|
| `BATCH_SIZE` | 20 | Пар сообщений за батч |
| `CHECK_INTERVAL_MS` | 120000 | Проверка каждые 2 мин |
| `MIN_NEW_MESSAGES` | 5 | Минимум новых сообщений для синхронизации |
| `CONTAINER_TAG` | `your-name` | Тег контейнера в Supermemory |

> ⚠️ Замени `CONTAINER_TAG` во всех скриптах (`sm-daemon.js`, `sm-recall.js`, `sm-sync-files.js`) на своё имя или идентификатор.

## Автозапуск при рестарте контейнера

Добавь в `HEARTBEAT.md`:

```markdown
## Daemon watchdog
- Check sm-daemon: `bash skills/supermemory/scripts/sm-control.sh status`
- If not running: `bash skills/supermemory/scripts/sm-control.sh start`
```

## Требования

- Node.js 18+
- [OpenClaw](https://github.com/hostinger/openclaw)
- [Supermemory](https://supermemory.ai) аккаунт (бесплатный план — 2000 документов)
- `supermemory` npm пакет v4.11.1

## Лицензия

MIT
