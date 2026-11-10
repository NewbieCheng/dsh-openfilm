import { randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const MAX_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_SCOPES = 1024;
const MAX_SCOPES = 10000;

function isFrameIdentity(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

// Require an existing, already-canonical absolute path, not an alias or symlink.
// Do not propagate filesystem errors: they can contain sensitive paths.
function isCanonicalPath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) return false;
  try { return realpathSync.native(value) === value; } catch { return false; }
}

/**
 * Host-only scope mechanism, not a request authenticator or a complete plugin.
 *
 * Before issue(), the Host must authenticate the trusted outer client and its
 * actual user-initiated project selection, authorize the project ID and resolve
 * its canonical path. frameIdentity must be a unique opaque Host-owned object
 * for the authenticated window/iframe lifecycle, never a renderer-supplied ID.
 *
 * verify({ token, frameIdentity }, projectId, realpath) requires the Host to
 * construct the first argument: token comes from the request, but frameIdentity
 * must be independently derived from authenticated transport/frame state, NOT
 * copied from the request, referer, or project ID. The outer client receives the
 * token only after the validated selection and must protect it from other frames.
 * Wire revocation to project changes, frame teardown and logout; close on Host
 * shutdown. The module itself provides none of those integrations.
 *
 * This does not defend against a compromised trusted parent or same-origin XSS.
 * Path checks are snapshots, not filesystem handles: callers must separately
 * address filesystem replacement/TOCTOU when opening or modifying a project.
 * Never log tokens, project paths, or request bodies/headers containing them.
 */
export class OfficialProjectScope {
  #scopes = new Map();
  #ttlMs;
  #maxScopes;
  #closed = false;

  constructor({ ttlMs = DEFAULT_TTL_MS, maxScopes = DEFAULT_MAX_SCOPES } = {}) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > MAX_TTL_MS) {
      throw new RangeError('invalid scope lifetime');
    }
    if (!Number.isSafeInteger(maxScopes) || maxScopes < 1 || maxScopes > MAX_SCOPES) {
      throw new RangeError('invalid scope limit');
    }
    this.#ttlMs = ttlMs;
    this.#maxScopes = maxScopes;
  }

  #purgeExpired(now) {
    const wallNow = Date.now();
    for (const [token, scope] of this.#scopes) {
      if (now >= scope.expires || wallNow >= scope.wallExpires) this.#scopes.delete(token);
    }
  }

  /** Issue a new capability after Host-side selection validation only. */
  issue(frameIdentity, projectId, realpath) {
    if (this.#closed) throw new Error('scope store is closed');
    if (!isFrameIdentity(frameIdentity) || typeof projectId !== 'string' || !projectId || !isCanonicalPath(realpath)) {
      throw new TypeError('invalid scope parameters');
    }
    const now = performance.now();
    this.#purgeExpired(now);
    let previous;
    for (const [token, scope] of this.#scopes) {
      if (scope.frameIdentity === frameIdentity) { previous = token; break; }
    }
    if (previous === undefined && this.#scopes.size >= this.#maxScopes) {
      throw new Error('scope limit reached');
    }
    // 256 bits of OS randomness. Avoid replacing a live entry even on collision.
    let token;
    do { token = randomBytes(32).toString('base64url'); } while (this.#scopes.has(token));
    if (previous !== undefined) this.#scopes.delete(previous);
    this.#scopes.set(token, { frameIdentity, projectId, realpath, expires: now + this.#ttlMs, wallExpires: Date.now() + this.#ttlMs });
    return token;
  }

  /** Return false on any mismatch, expiration, revocation, or path failure. */
  verify(frameCapability, projectId, realpath) {
    if (this.#closed || !frameCapability || typeof frameCapability !== 'object') return false;
    const { token, frameIdentity } = frameCapability;
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token) || !isFrameIdentity(frameIdentity)) return false;
    const now = performance.now();
    this.#purgeExpired(now);
    const scope = this.#scopes.get(token);
    return !!scope && scope.frameIdentity === frameIdentity && scope.projectId === projectId &&
      scope.realpath === realpath && isCanonicalPath(realpath);
  }

  /** Revoke one token; call only from an authenticated Host control path. */
  revoke(token) {
    return typeof token === 'string' && this.#scopes.delete(token);
  }

  /** Revoke every scope associated with a Host-owned frame identity. */
  revokeFrame(frameIdentity) {
    if (!isFrameIdentity(frameIdentity)) return 0;
    let count = 0;
    for (const [token, scope] of this.#scopes) {
      if (scope.frameIdentity === frameIdentity) { this.#scopes.delete(token); count++; }
    }
    return count;
  }

  /** Permanently revoke all capabilities and prevent further issuance. */
  close() {
    this.#closed = true;
    this.#scopes.clear();
  }
}
