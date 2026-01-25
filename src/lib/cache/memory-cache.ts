import { Cache } from "./cache.interface";

type Entry<V> = { value: V; expiresAt: number; lastAccessed: number };

interface MemoryCacheOptions {
  defaultTtlMs?: number;
  cleanupIntervalMs?: number;
  /** Maximum number of entries in cache (default: 10000) */
  maxSize?: number;
}

/**
 * In-memory cache with LRU eviction and TTL support
 * - Automatically evicts least recently used entries when maxSize is exceeded
 * - Entries expire based on TTL
 * - Periodic cleanup of expired entries
 */
export class MemoryCache implements Cache {
  private store = new Map<string, Entry<JsonValue>>();
  private defaultTtlMs: number;
  private maxSize: number;

  constructor(opts: MemoryCacheOptions = {}) {
    this.defaultTtlMs = opts.defaultTtlMs ?? Infinity;
    this.maxSize = opts.maxSize ?? 10000;

    const interval = opts.cleanupIntervalMs ?? 60_000;
    if (isFinite(interval) && interval > 0) {
      setInterval(() => this.sweep(), interval).unref();
    }
  }

  async get<T>(key: string): Promise<T | undefined> {
    const e = this.store.get(key);
    if (!e) return undefined;

    if (Date.now() > e.expiresAt) {
      this.store.delete(key);
      return undefined;
    }

    // Update last accessed time for LRU tracking
    e.lastAccessed = Date.now();
    return e.value as T;
  }

  async set(key: string, value: any, ttlMs = this.defaultTtlMs) {
    const now = Date.now();
    const expiresAt = isFinite(ttlMs) ? now + ttlMs : Infinity;

    // Check if we need to evict entries before adding new one
    // Only evict if adding a new key (not updating existing)
    if (!this.store.has(key) && this.store.size >= this.maxSize) {
      this.evictLRU();
    }

    this.store.set(key, { value, expiresAt, lastAccessed: now });
  }

  async has(key: string) {
    return (await this.get(key)) !== undefined;
  }

  async delete(key: string) {
    this.store.delete(key);
  }

  async clear() {
    this.store.clear();
  }

  async getAll(): Promise<Map<string, unknown>> {
    const result = new Map<string, unknown>();
    const now = Date.now();

    for (const [key, entry] of this.store) {
      if (now <= entry.expiresAt) {
        result.set(key, entry.value);
      } else {
        // Clean up expired entries while we're iterating
        this.store.delete(key);
      }
    }

    return result;
  }

  /**
   * Get current cache size
   */
  size(): number {
    return this.store.size;
  }

  /**
   * Get cache statistics
   */
  stats(): { size: number; maxSize: number; utilization: number } {
    return {
      size: this.store.size,
      maxSize: this.maxSize,
      utilization: this.store.size / this.maxSize,
    };
  }

  /**
   * Evict least recently used entries
   * Removes 10% of entries to avoid frequent evictions
   */
  private evictLRU(): void {
    // Evict 10% of maxSize entries at once to avoid frequent evictions
    const evictCount = Math.max(1, Math.floor(this.maxSize * 0.1));

    // Sort by lastAccessed ascending (oldest first)
    const entries = Array.from(this.store.entries()).sort(
      ([, a], [, b]) => a.lastAccessed - b.lastAccessed
    );

    // Delete the oldest entries
    for (let i = 0; i < evictCount && i < entries.length; i++) {
      this.store.delete(entries[i][0]);
    }
  }

  /**
   * Sweep expired entries
   */
  private sweep() {
    const now = Date.now();
    for (const [k, { expiresAt }] of this.store) {
      if (now > expiresAt) this.store.delete(k);
    }
  }
}
