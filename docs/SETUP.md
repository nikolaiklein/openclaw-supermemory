# Supermemory Auto-Sync — Методичка NN02

**Дата:** 2026-02-14
**Статус:** Готово к развёртыванию. API вызовы проверены по SDK v4.11.1.

---

## Что это даёт

1. **Полная память всех разговоров** — каждое сообщение автоматически попадает в Supermemory
2. **Мгновенный поиск** — hybrid search по всей истории за <300ms
3. **Ноль токенов** — daemon = отдельный Node.js процесс, AI не участвует в синхронизации
4. **Граф знаний** — Supermemory сам строит связи между фактами, обновляет устаревшие, забывает неактуальные
5. **Дедупликация** — используем `customId` для каждого батча, повторная отправка не создаёт дубли
6. **Автовоскрешение** — daemon перезапускается через HEARTBEAT.md watchdog

---

## Архитектура

```
┌─────────────────┐     JSONL      ┌──────────────┐     REST API     ┌──────────────┐
│  OpenClaw        │ ───────────▶  │  Sync Daemon  │ ──────────────▶  │  Supermemory  │
│  (сессии)        │   файлы       │  (Node.js)    │   батчи          │  (cloud)      │
└─────────────────┘                └──────────────┘                  └──────────────┘
                                                                            │
┌─────────────────┐                ┌──────────────┐     search API          │
│  NN02 (AI)       │ ◀──────────── │ recall script │ ◀──────────────────────┘
│  exec 1 команду  │   stdout      │  (Node.js)   │   результат <300ms
└─────────────────┘                └──────────────┘
```

---

## Расположение файлов

Все скрипты живут в скилле:

```
skills/supermemory/
├── SKILL.md                         — инструкция для NN02 (когда/как вызывать recall)
└── scripts/
    ├── sm-recall.js                 — поиск по памяти (NN02 вызывает через exec)
    ├── sm-sync-files.js             — ручная синхронизация MEMORY.md + daily notes
    ├── sm-daemon.js                 — фоновый daemon автосинхронизации разговоров
    └── sm-control.sh                — управление daemon: start/stop/restart/status/logs
```

Рабочие файлы daemon:
```
memory/
├── sm-sync-state.json               — состояние синхронизации (offset, счётчики)
├── sm-daemon.pid                    — PID файл daemon
└── sm-daemon.log                    — логи daemon
```

---

## Шаг 1: Получи API ключ Supermemory

1. Зайди на https://supermemory.ai
2. Зарегистрируйся / войди
3. Скопируй API ключ (начинается с `sm_...`)

---

## Шаг 2: Добавь API ключ в OpenClaw

Файл: `/data/.openclaw/agents/main/agent/auth-profiles.json`

Добавь в секцию `profiles`:

```json
"supermemory:default": {
  "type": "api_key",
  "provider": "supermemory",
  "apiKey": "sm_ТВОЙ_КЛЮЧ"
}
```

**Не удаляй** существующие профили (anthropic и т.д.) — просто добавь рядом.

Проверь права:
```bash
chmod 600 /data/.openclaw/agents/main/agent/auth-profiles.json
```

---

## Шаг 3: Установи Supermemory SDK

```bash
cd /data/.openclaw/workspace
npm install supermemory@4.11.1
```

**Проверка:**
```bash
node -e "const _sm = require('supermemory'); const S = _sm.default || _sm; console.log('OK, constructor:', typeof S)"
```

> Фиксируем версию 4.11.1 чтобы обновления SDK не сломали API.
> Import: скрипты используют `_sm.default || _sm` — работает и если default export, и если прямой.

---

## Шаг 4: Запуск

```bash
# 1. Убедись что директория memory существует
mkdir -p /data/.openclaw/workspace/memory

# 2. Запусти daemon
bash /data/.openclaw/workspace/skills/supermemory/scripts/sm-control.sh start

# 3. Проверь статус
bash /data/.openclaw/workspace/skills/supermemory/scripts/sm-control.sh status

# 4. Синхронизируй файлы памяти (разовая операция)
node /data/.openclaw/workspace/skills/supermemory/scripts/sm-sync-files.js

# 5. Тест поиска
node /data/.openclaw/workspace/skills/supermemory/scripts/sm-recall.js profile
node /data/.openclaw/workspace/skills/supermemory/scripts/sm-recall.js recall "test"
```

---

## Шаг 5: Автозапуск daemon при рестарте контейнера

Добавь в `HEARTBEAT.md`:

```markdown
## Daemon watchdog
- Check sm-daemon: `bash /data/.openclaw/workspace/skills/supermemory/scripts/sm-control.sh status`
- If not running: `bash /data/.openclaw/workspace/skills/supermemory/scripts/sm-control.sh start`
```

Heartbeat проверяет раз в ~30 мин. Если daemon упал или контейнер перезапустился — поднимает. Стоимость: 1 exec (0 токенов AI).

---

## Управление daemon

```bash
# Запустить
bash skills/supermemory/scripts/sm-control.sh start

# Остановить
bash skills/supermemory/scripts/sm-control.sh stop

# Перезапустить
bash skills/supermemory/scripts/sm-control.sh restart

# Статус + state
bash skills/supermemory/scripts/sm-control.sh status

# Логи (live)
bash skills/supermemory/scripts/sm-control.sh logs
```

---

## Как NN02 использует recall

Когда Андрей спрашивает что-то из прошлых разговоров:

```bash
node /data/.openclaw/workspace/skills/supermemory/scripts/sm-recall.js recall "что обсуждали про маркетинг"
```

Скилл `supermemory` (SKILL.md) описывает когда вызывать и когда НЕ вызывать recall, чтобы не тратить токены зря.

---

## Технические детали

### API вызовы (проверены по SDK v4.11.1)

| Метод | Использование | Параметры |
|---|---|---|
| `client.add()` | Daemon + sync-files | `content, containerTag, customId, metadata` |
| `client.profile()` | Recall | `containerTag, q, threshold` → `profile.static[], profile.dynamic[]` |
| `client.search.memories()` | Recall | `q, containerTag, searchMode:'hybrid', limit, threshold, rerank` |

> Альтернатива `search.memories` — `search.execute`. Оба существуют в SDK.

### containerTag

Используем `nn02-andrew` — один тег для всех данных. Supermemory группирует всё по этому тегу.

> `containerTag` (строка) — актуальный параметр. `containerTags` (массив) — deprecated.

### Дедупликация

- Файлы: `customId: 'memory-md-main'`, `customId: 'daily-2026-02-14'`
- Разговоры: `customId: 'session-{sessionId}-batch-{N}'`

При повторной отправке с тем же customId — Supermemory обновляет документ, не дублирует.

### Формат JSONL сессий OpenClaw

```json
{"type":"message","message":{"role":"user","content":[{"type":"text","text":"..."}],"timestamp":1771081397308}}
```

Daemon читает только `type === 'message'`, фильтрует `role === 'user' | 'assistant'`, пропускает heartbeat и пустые.

### Daemon настройки

| Параметр | Значение | Описание |
|---|---|---|
| BATCH_SIZE | 20 | 20 пар сообщений (40 штук) за батч |
| CHECK_INTERVAL_MS | 120000 | Проверка каждые 2 минуты |
| MIN_NEW_MESSAGES | 5 | Минимум новых сообщений для синхронизации |

---

## Troubleshooting

| Проблема | Решение |
|---|---|
| Daemon не стартует | `cat memory/sm-daemon.log` |
| "No supermemory:default profile" | Проверь auth-profiles.json |
| SDK не найден | `npm install supermemory@4.11.1` в workspace |
| Поиск пустой | Подожди 2-5 мин после синхронизации (индексация асинхронная) |
| Daemon умер | `bash skills/supermemory/scripts/sm-control.sh start` |

---

## Стоимость

- **Supermemory:** Бесплатный план — 2000 документов
- **Токены AI:** 0 на синхронизацию. Recall = 1 exec при необходимости
- **Ресурсы сервера:** ~20MB RAM для daemon
