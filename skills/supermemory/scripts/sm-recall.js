#!/usr/bin/env node
'use strict';

// CommonJS: try .default first (standard for ESM default export), fallback to direct
const _sm = require('supermemory');
const Supermemory = _sm.default || _sm;
const fs = require('fs');

// ============================================================================
// CONFIGURATION - with environment variable support and validation
// ============================================================================

/**
 * Get CONTAINER_TAG from environment variable with validation
 * Falls back to 'default' only if env var is not set
 * @returns {string} validated container tag
 */
function getContainerTag() {
  const tag = process.env.SM_CONTAINER_TAG;
  
  // If not set, use fallback but warn
  if (!tag) {
    console.warn('[WARN] SM_CONTAINER_TAG not set, using fallback "default". Set env var to avoid data mixing.');
    return 'default';
  }
  
  // Validate: reject placeholder values
  const invalidTags = ['your-name', 'your_name', 'yourname', 'test', 'example', ''];
  const normalizedTag = tag.trim().toLowerCase();
  
  if (invalidTags.includes(normalizedTag)) {
    console.error(`[ERROR] SM_CONTAINER_TAG="${tag}" is a placeholder value. Please set a unique identifier.`);
    process.exit(1);
  }
  
  // Validate: minimum length
  if (tag.trim().length < 2) {
    console.error(`[ERROR] SM_CONTAINER_TAG must be at least 2 characters.`);
    process.exit(1);
  }
  
  return tag.trim();
}

const CONFIG = {
  AUTH_PATH: process.env.SM_AUTH_PATH || '/data/.openclaw/agents/main/agent/auth-profiles.json',
  CONTAINER_TAG: getContainerTag(),
  // API timeout and retry configuration
  API_TIMEOUT_MS: parseInt(process.env.SM_API_TIMEOUT_MS, 10) || 30000,
  API_RETRY_ATTEMPTS: parseInt(process.env.SM_API_RETRY_ATTEMPTS, 10) || 3,
  API_RETRY_BASE_DELAY_MS: parseInt(process.env.SM_API_RETRY_BASE_DELAY_MS, 10) || 1000,
};

// ============================================================================
// LOGGING with sensitive data scrubbing
// ============================================================================

/**
 * Patterns to scrub from log messages to prevent API key leakage
 */
const SENSITIVE_PATTERNS = [
  { regex: /sm_[a-zA-Z0-9_]+/g, replacement: '[REDACTED_API_KEY]' },
  { regex: /api[_-]?key[:\s=]+["']?[^\s"']+["']?/gi, replacement: 'api_key=[REDACTED]' },
  { regex: /authorization[:\s=]+["']?[^\s"']+["']?/gi, replacement: 'authorization=[REDACTED]' },
  { regex: /bearer\s+[a-zA-Z0-9_\.\-]+/gi, replacement: 'Bearer [REDACTED]' },
];

/**
 * Scrub sensitive data from message
 * @param {string} msg - message to scrub
 * @returns {string} scrubbed message
 */
function scrubSensitiveData(msg) {
  if (typeof msg !== 'string') return msg;
  let scrubbed = msg;
  for (const pattern of SENSITIVE_PATTERNS) {
    scrubbed = scrubbed.replace(pattern.regex, pattern.replacement);
  }
  return scrubbed;
}

// ============================================================================
// API CALLS WITH TIMEOUT AND RETRY
// ============================================================================

/**
 * Sleep helper for exponential backoff
 * @param {number} ms - milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay with jitter
 * @param {number} attempt - current attempt (0-based)
 * @returns {number} delay in milliseconds
 */
function getRetryDelay(attempt) {
  // Exponential backoff: 1s, 2s, 4s + up to 1s random jitter
  const baseDelay = CONFIG.API_RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
  const jitter = Math.random() * 1000;
  return Math.min(baseDelay + jitter, 30000); // Cap at 30s
}

/**
 * Execute API call with timeout and retry logic
 * @param {Function} apiCall - async function that makes the API call
 * @param {string} operationName - name of operation for logging
 * @returns {Promise<any>} API call result
 */
async function apiCallWithRetry(apiCall, operationName) {
  let lastError;
  
  for (let attempt = 0; attempt < CONFIG.API_RETRY_ATTEMPTS; attempt++) {
    try {
      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CONFIG.API_TIMEOUT_MS);
      
      try {
        // Pass signal to API call if supported
        const result = await apiCall({ signal: controller.signal });
        return result;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      lastError = err;
      
      // Don't retry on client errors (4xx except 429 rate limit)
      if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500 && err.statusCode !== 429) {
        throw err;
      }
      
      // Don't retry on abort if it was user-initiated
      if (err.name === 'AbortError') {
        throw err;
      }
      
      // Log retry attempt
      if (attempt < CONFIG.API_RETRY_ATTEMPTS - 1) {
        const delay = getRetryDelay(attempt);
        console.error(`⚠️ ${operationName} failed (attempt ${attempt + 1}/${CONFIG.API_RETRY_ATTEMPTS}): ${scrubSensitiveData(err.message)}. Retrying in ${Math.round(delay)}ms...`);
        await sleep(delay);
      }
    }
  }
  
  // All retries exhausted
  throw lastError;
}

// ============================================================================
// AUTHENTICATION
// ============================================================================

let apiKey;
try {
  const auth = JSON.parse(fs.readFileSync(CONFIG.AUTH_PATH, 'utf8'));
  apiKey = auth.profiles['supermemory:default']?.apiKey;
  if (!apiKey) throw new Error('No supermemory:default profile found');
} catch (err) {
  console.error('❌ Auth error:', scrubSensitiveData(err.message));
  process.exit(1);
}

const client = new Supermemory({ apiKey });
const cmd = process.argv[2];
const query = process.argv.slice(3).join(' ');

// ============================================================================
// COMMANDS
// ============================================================================

async function recall(q) {
  // Fetch profile with retry and timeout
  const profile = await apiCallWithRetry(
    async ({ signal }) => client.profile({
      containerTag: CONFIG.CONTAINER_TAG,
      q: q,
      threshold: 0.4
    }),
    'Profile fetch'
  );

  console.log('=== PROFILE ===');
  if (profile.profile?.static?.length > 0) {
    console.log('📌 Static:');
    profile.profile.static.forEach(f => console.log(`  - ${f}`));
  }
  if (profile.profile?.dynamic?.length > 0) {
    console.log('🔄 Dynamic:');
    profile.profile.dynamic.forEach(f => console.log(`  - ${f}`));
  }

  // Search with retry and timeout
  const search = await apiCallWithRetry(
    async ({ signal }) => client.search.memories({
      q: q,
      containerTag: CONFIG.CONTAINER_TAG,
      searchMode: 'hybrid',
      limit: 10,
      threshold: 0.4,
      rerank: true
    }),
    'Search memories'
  );

  console.log(`\n=== SEARCH (${search.timing}ms, ${search.total} total) ===`);
  if (search.results?.length > 0) {
    search.results.forEach((r, i) => {
      const text = r.memory || r.chunk || '(no content)';
      console.log(`${i + 1}. [${(r.similarity * 100).toFixed(0)}%] ${text}`);
      if (r.metadata?.session_date) console.log(`   📅 ${r.metadata.session_date}`);
    });
  } else {
    console.log('Nothing found.');
  }
}

async function main() {
  if (cmd === 'recall' && query) {
    await recall(query);
  } else if (cmd === 'profile') {
    const profile = await apiCallWithRetry(
      async ({ signal }) => client.profile({ containerTag: CONFIG.CONTAINER_TAG }),
      'Profile fetch'
    );
    console.log(JSON.stringify(profile, null, 2));
  } else {
    console.log('Usage:');
    console.log('  node sm-recall.js recall "query"');
    console.log('  node sm-recall.js profile');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('❌', scrubSensitiveData(err.message));
  process.exit(1);
});
