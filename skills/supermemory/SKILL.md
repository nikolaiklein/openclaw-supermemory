---
name: supermemory
description: >
  Long-term memory recall and search across all past conversations via Supermemory API.
  Use when asked about past events, decisions, numbers, facts, people, or anything
  discussed in previous sessions that is NOT in current context or MEMORY.md.
  Also use when the user says "помнишь", "вспомни", "мы обсуждали", "что было",
  "какие числа", "что решили", or references a specific past date/event.
  Do NOT use for questions answerable from current conversation, MEMORY.md, or general knowledge.
---

# Supermemory — Long-Term Recall

## When to call recall

Call recall ONLY when ALL of these are true:
1. The answer requires information from **past sessions** (not the current one)
2. The information is **not** in MEMORY.md or today's memory file
3. The question is **specific** enough to search (not "tell me everything")

## When NOT to call recall

- General knowledge questions ("what is Docker?") → just answer
- Current conversation context → you already have it
- Information clearly in MEMORY.md → you already read it
- Simple greetings, commands, small talk → just respond
- Heartbeat checks → never call recall

## How to use

```bash
node /data/.openclaw/workspace/skills/supermemory/scripts/sm-recall.js recall "search query in natural language"
```

Write the query in the **language of the original conversation** (usually Russian).
Be specific: "выручка за март" > "числа" > "всё".

## Reading results

Output has two sections:
- **PROFILE** — static/dynamic facts Supermemory extracted (always useful context)
- **SEARCH** — ranked results with similarity %. Focus on >60% matches.

Use the results to answer the user's question. Cite dates when available.

## Daemon management

The sync daemon runs in background and requires no AI interaction.
Check/restart only if recall returns empty when it shouldn't:

```bash
bash /data/.openclaw/workspace/skills/supermemory/scripts/sm-control.sh status
bash /data/.openclaw/workspace/skills/supermemory/scripts/sm-control.sh start
```

## Manual file sync

Sync MEMORY.md and daily notes manually (run after major MEMORY.md updates):

```bash
node /data/.openclaw/workspace/skills/supermemory/scripts/sm-sync-files.js
```
