#!/bin/bash
DAEMON="/data/.openclaw/workspace/skills/supermemory/scripts/sm-daemon.js"
PID_FILE="/data/.openclaw/workspace/memory/sm-daemon.pid"
LOG_FILE="/data/.openclaw/workspace/memory/sm-daemon.log"

case "$1" in
  start)
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "✅ Already running (PID: $(cat "$PID_FILE"))"
      exit 0
    fi
    nohup node "$DAEMON" >> "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    echo "✅ Started (PID: $(cat "$PID_FILE"))"
    ;;
  stop)
    if [ ! -f "$PID_FILE" ] || ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "❌ Not running"; rm -f "$PID_FILE"; exit 0
    fi
    kill "$(cat "$PID_FILE")"; rm -f "$PID_FILE"
    echo "🛑 Stopped"
    ;;
  restart) $0 stop; sleep 1; $0 start ;;
  status)
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "✅ Running (PID: $(cat "$PID_FILE"))"
      [ -f "/data/.openclaw/workspace/memory/sm-sync-state.json" ] && cat /data/.openclaw/workspace/memory/sm-sync-state.json
    else
      echo "❌ Not running"; rm -f "$PID_FILE"
    fi
    ;;
  logs) tail -f "$LOG_FILE" ;;
  *) echo "Usage: $0 {start|stop|restart|status|logs}"; exit 1 ;;
esac
