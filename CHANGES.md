# Changes in v3.1

This document summarizes all changes made to fix critical security and stability issues identified in the security audit.

## 🔴 Critical Fixes

### 1. Hardcoded CONTAINER_TAG (SECURITY)
**Files:** `sm-daemon.js`, `sm-recall.js`, `sm-sync-files.js`

**Problem:** `CONTAINER_TAG: 'your-name'` was hardcoded in all scripts. If users forgot to change it, all data would go into the same container, causing data mixing between users.

**Solution:**
- Moved `CONTAINER_TAG` to environment variable `SM_CONTAINER_TAG`
- Added validation that rejects placeholder values (`your-name`, `test`, `example`, etc.)
- Minimum length validation (2+ characters)
- Falls back to `'default'` only with warning if env var not set
- Scripts exit with error if placeholder value detected

**Usage:**
```bash
export SM_CONTAINER_TAG=my-unique-id
```

---

### 2. No HTTP Timeouts (STABILITY)
**Files:** `sm-daemon.js`, `sm-recall.js`, `sm-sync-files.js`

**Problem:** Supermemory SDK v4.11.1 doesn't set default timeouts. If API hangs, daemon hangs forever.

**Solution:**
- Added `AbortController` with 30-second timeout (configurable via `SM_API_TIMEOUT_MS`)
- Timeout is applied to all API calls via `apiCallWithRetry()` wrapper
- Proper cleanup of timeout resources with `clearTimeout()`

---

### 3. No Retry Logic (RELIABILITY)
**Files:** `sm-daemon.js`, `sm-recall.js`, `sm-sync-files.js`

**Problem:** Temporary network errors (502, timeout) would abort entire sync operation.

**Solution:**
- Implemented `apiCallWithRetry()` function with:
  - Configurable retry attempts (default: 3, via `SM_API_RETRY_ATTEMPTS`)
  - Exponential backoff with jitter: 1s, 2s, 4s + random 0-1s
  - Smart retry: doesn't retry 4xx client errors (except 429 rate limit)
  - Doesn't retry user-initiated aborts

---

### 4. Race Condition in Graceful Shutdown (STABILITY)
**File:** `sm-daemon.js`

**Problem:** Original code:
```javascript
const shutdown = () => { 
  log('🛑 Shutdown'); 
  saveState(loadState()); // ← reloads state from file, losing unsaved changes
  process.exit(0); 
};
```

**Solution:**
- Keep `currentState` in closure variable
- Use `currentState` directly in shutdown handler instead of reloading
- Ensures all unsaved changes are persisted on shutdown

---

### 5. PID File Not Cleaned on Crash (OPERABILITY)
**File:** `sm-control.sh`

**Problem:** If daemon was killed with SIGKILL or crashed (OOM), PID file remained. Next `start` would fail with "Already running".

**Solution:**
- Added `is_daemon_running()` function that verifies:
  - Process with PID exists (`kill -0`)
  - Process cmdline contains "sm-daemon.js" (prevents PID reuse false positive)
- Added `cleanup_stale_pid()` function to remove orphaned PID files
- `get_valid_pid()` helper combines validation and cleanup
- Applied to all commands: `start`, `stop`, `status`, `check`

---

### 6. API Key Can Leak in Logs (SECURITY)
**Files:** `sm-daemon.js`, `sm-recall.js`, `sm-sync-files.js`

**Problem:** Error messages from SDK might contain API keys in URLs or headers, which would be logged directly.

**Solution:**
- Implemented `scrubSensitiveData()` function with regex patterns for:
  - Supermemory API keys (`sm_...`)
  - Generic API key patterns
  - Authorization headers
  - Bearer tokens
- Applied scrubbing to all log/error output
- Pattern: `[REDACTED_API_KEY]`, `[REDACTED]`

---

## 🟡 Additional Improvements

### JSON Parse Error Logging
**File:** `sm-daemon.js`

Previously JSON parse errors in session files were silently ignored. Now logged with line number for debugging.

### Better Error Handling in sm-sync-files.js
**File:** `sm-sync-files.js`

Previously one failed upload would abort entire sync. Now each file is wrapped in try-catch, failures are logged but sync continues for other files.

### Silent Check Command
**File:** `sm-control.sh`

Added `check` command for heartbeat scripts:
```bash
bash sm-control.sh check  # exits 0 if running, 1 if not (no output)
```

---

## 📁 New Files

### `.env.example`
Complete example configuration file documenting all environment variables:
- Required: `SM_CONTAINER_TAG`
- Optional paths, batch sizes, intervals
- API timeout and retry configuration

---

## 📄 Modified Files

| File | Changes |
|------|---------|
| `sm-daemon.js` | +350 lines: env config, validation, timeout, retry, scrubbing, race condition fix |
| `sm-recall.js` | +200 lines: env config, validation, timeout, retry, scrubbing |
| `sm-sync-files.js` | +200 lines: env config, validation, timeout, retry, scrubbing, per-file error handling |
| `sm-control.sh` | +120 lines: stale PID detection, verification functions, check command |
| `README.md` | Complete rewrite: env var documentation, migration guide, v3.1 features |

---

## 🔒 Security Improvements Summary

| Issue | Before | After |
|-------|--------|-------|
| Data isolation | Hardcoded `your-name` | Validated env var |
| API key in logs | Direct logging | Regex scrubbing |
| Process management | Simple PID check | Verified cmdline match |

## 🚀 Stability Improvements Summary

| Issue | Before | After |
|-------|--------|-------|
| API hangs | Forever | 30s timeout |
| Network errors | Fail immediately | 3 retries with backoff |
| Shutdown | Race condition | Proper state preservation |
| Crash recovery | Manual cleanup | Automatic stale PID cleanup |

---

## Migration Guide from v3.0

1. Set the required environment variable:
   ```bash
   export SM_CONTAINER_TAG=your-unique-id
   ```

2. (Optional) Review other settings in `.env.example`

3. All other settings have sensible defaults — backward compatible.

4. Run the scripts as usual.

---

*Audit completed: 2026-02-15*  
*Fixes implemented: v3.1*
