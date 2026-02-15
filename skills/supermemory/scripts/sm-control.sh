#!/bin/bash

# Supermemory Daemon Control Script
# Handles daemon lifecycle with proper stale PID detection

DAEMON="/data/.openclaw/workspace/skills/supermemory/scripts/sm-daemon.js"
PID_FILE="/data/.openclaw/workspace/memory/sm-daemon.pid"
LOG_FILE="/data/.openclaw/workspace/memory/sm-daemon.log"

# ============================================================================
# Helper Functions
# ============================================================================

#
# Check if a process with given PID exists and is our daemon
# Returns 0 if running, 1 if not running or stale
#
is_daemon_running() {
  local pid="$1"
  
  # Check if PID file exists
  if [ -z "$pid" ] || [ ! -f "$PID_FILE" ]; then
    return 1
  fi
  
  # Check if process exists
  if ! kill -0 "$pid" 2>/dev/null; then
    return 1
  fi
  
  # Verify it's actually a node process running our daemon
  # This prevents false positives if PID was reused by another process
  local cmdline
  cmdline=$(cat "/proc/$pid/cmdline" 2>/dev/null | tr '\0' ' ')
  if [[ "$cmdline" == *"sm-daemon.js"* ]]; then
    return 0
  fi
  
  return 1
}

#
# Clean up stale PID file
#
cleanup_stale_pid() {
  if [ -f "$PID_FILE" ]; then
    local old_pid
    old_pid=$(cat "$PID_FILE" 2>/dev/null)
    echo "🧹 Cleaning stale PID file (PID: $old_pid not running)"
    rm -f "$PID_FILE"
  fi
}

#
# Get current PID from file if valid
#
get_valid_pid() {
  if [ -f "$PID_FILE" ]; then
    local pid
    pid=$(cat "$PID_FILE" 2>/dev/null)
    if is_daemon_running "$pid"; then
      echo "$pid"
      return 0
    else
      cleanup_stale_pid
    fi
  fi
  return 1
}

# ============================================================================
# Commands
# ============================================================================

case "$1" in
  start)
    # Check for existing/stale PID
    local existing_pid
    existing_pid=$(get_valid_pid)
    
    if [ -n "$existing_pid" ]; then
      echo "✅ Already running (PID: $existing_pid)"
      exit 0
    fi
    
    # Ensure log directory exists
    mkdir -p "$(dirname "$LOG_FILE")"
    
    # Start daemon
    nohup node "$DAEMON" >> "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    
    # Verify it started
    sleep 0.5
    new_pid=$(cat "$PID_FILE" 2>/dev/null)
    if is_daemon_running "$new_pid"; then
      echo "✅ Started (PID: $new_pid)"
    else
      echo "❌ Failed to start daemon (check logs: $LOG_FILE)"
      rm -f "$PID_FILE"
      exit 1
    fi
    ;;
    
  stop)
    local pid
    pid=$(get_valid_pid)
    
    if [ -z "$pid" ]; then
      echo "❌ Not running"
      exit 0
    fi
    
    # Try graceful shutdown first
    kill "$pid" 2>/dev/null
    
    # Wait up to 5 seconds for graceful shutdown
    local waited=0
    while is_daemon_running "$pid" && [ $waited -lt 5 ]; do
      sleep 1
      waited=$((waited + 1))
    done
    
    # Force kill if still running
    if is_daemon_running "$pid"; then
      echo "⚠️ Force killing PID $pid..."
      kill -9 "$pid" 2>/dev/null
      sleep 0.5
    fi
    
    rm -f "$PID_FILE"
    echo "🛑 Stopped"
    ;;
    
  restart)
    $0 stop
    sleep 1
    $0 start
    ;;
    
  status)
    local pid
    pid=$(get_valid_pid)
    
    if [ -n "$pid" ]; then
      echo "✅ Running (PID: $pid)"
      if [ -f "/data/.openclaw/workspace/memory/sm-sync-state.json" ]; then
        echo "📊 State:"
        cat /data/.openclaw/workspace/memory/sm-sync-state.json
      fi
    else
      echo "❌ Not running"
    fi
    ;;
    
  logs)
    if [ -f "$LOG_FILE" ]; then
      tail -f "$LOG_FILE"
    else
      echo "❌ Log file not found: $LOG_FILE"
      exit 1
    fi
    ;;
    
  check)
    # Internal command for heartbeat checks - returns 0 if running, 1 if not
    local pid
    pid=$(get_valid_pid)
    
    if [ -n "$pid" ]; then
      exit 0
    else
      exit 1
    fi
    ;;
    
  *)
    echo "Usage: $0 {start|stop|restart|status|logs|check}"
    echo ""
    echo "Commands:"
    echo "  start   - Start the daemon (with stale PID cleanup)"
    echo "  stop    - Stop the daemon (graceful, with fallback to force kill)"
    echo "  restart - Restart the daemon"
    echo "  status  - Show daemon status and state"
    echo "  logs    - Follow log output"
    echo "  check   - Silent check for heartbeat (exits 0 if running)"
    exit 1
    ;;
esac
