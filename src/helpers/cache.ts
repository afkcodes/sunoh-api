import Redis from 'ioredis';

class IOValKeyCache {
  private client: Redis;
  private defaultTTL: number;

  /**
   * Create a new IOValKeyCache instance
   * @param url Redis/Valkey connection URL (default: redis://localhost:6379)
   * @param ttl Default TTL in seconds (default: 5 hours)
   */
  constructor(url: string = 'redis://localhost:6379', ttl: number = 3600) {
    this.defaultTTL = ttl;

    // Create the ioredis client (works with Valkey)
    this.client = new Redis(url, {
      // Optional: Add reconnect strategy
      retryStrategy: (times) => {
        // Retry with exponential backoff
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    this.client.on('error', (err) => {
      console.error('Redis/Valkey Client Error:', err);
    });

    this.client.on('connect', () => {
      console.log('Connected to Redis/Valkey server');
    });
  }

  /**
   * Close the connection to the Redis/Valkey server
   */
  async disconnect(): Promise<void> {
    await this.client.quit();
  }

  /**
   * Set a value in the cache with the default TTL
   * Automatically handles serialization of objects, arrays, etc.
   *
   * @param key Cache key
   * @param value Any value to cache (any type)
   * @param ttl Optional custom TTL in seconds
   */
  async set(key: string, value: any, ttl?: number): Promise<void> {
    // Convert any non-string values to JSON
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);

    // Set with expiry
    await this.client.set(key, stringValue, 'EX', ttl || this.defaultTTL);
  }

  /**
   * Get a value from the cache
   * Automatically handles deserialization to the original type
   *
   * @param key Cache key
   * @returns The cached value or null if not found
   */
  async get<T = any>(key: string): Promise<T | null> {
    const value = await this.client.get(key);

    if (value === null) return null;

    // Try to parse as JSON, return as string if parsing fails
    try {
      return JSON.parse(value) as T;
    } catch (e) {
      return value as unknown as T;
    }
  }

  /**
   * Delete a value from the cache
   *
   * @param key Cache key
   * @returns Number of keys deleted (1 if successful, 0 if key didn't exist)
   */
  async delete(key: string): Promise<number> {
    return await this.client.del(key);
  }

  /**
   * Delete multiple values from the cache
   *
   * @param keys Array of cache keys to delete
   * @returns Number of keys deleted
   */
  async deleteMany(keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    return await this.client.del(...keys);
  }

  /**
   * Delete all keys in the cache with a specific pattern
   * WARNING: This can be resource-intensive on large datasets
   *
   * @param pattern Pattern to match keys (e.g., "prefix:*")
   * @returns Number of keys deleted
   */
  async deleteByPattern(pattern: string): Promise<number> {
    // Get all keys matching the pattern
    const keys = await this.client.keys(pattern);

    if (keys.length === 0) return 0;

    // Delete all matching keys
    return await this.client.del(...keys);
  }

  /**
   * Delete all keys in the current database
   * WARNING: Use with caution as this will remove ALL keys
   *
   * @returns 'OK' if successful
   */
  async deleteAll(): Promise<string> {
    return await this.client.flushdb();
  }

  /**
   * Check if a key exists in the cache
   *
   * @param key Cache key
   * @returns true if the key exists, false otherwise
   */
  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result === 1;
  }

  /**
   * Get the remaining TTL of a key in seconds
   *
   * @param key Cache key
   * @returns TTL in seconds, -2 if the key doesn't exist, -1 if the key exists but has no TTL
   */
  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  /**
   * Set multiple values in the cache
   *
   * @param entries Object with key-value pairs to cache
   * @param ttl Optional custom TTL in seconds
   */
  async setMany(entries: Record<string, any>, ttl?: number): Promise<void> {
    const pipeline = this.client.pipeline();
    const expirySeconds = ttl || this.defaultTTL;

    // Add all set commands to the pipeline
    for (const [key, value] of Object.entries(entries)) {
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value);

      pipeline.set(key, stringValue, 'EX', expirySeconds);
    }

    // Execute all commands in a single round trip
    await pipeline.exec();
  }

  /**
   * Get multiple values from the cache
   *
   * @param keys Array of cache keys
   * @returns Object with key-value pairs (null for missing keys)
   */
  async getMany<T = any>(keys: string[]): Promise<Record<string, T | null>> {
    if (keys.length === 0) return {};

    const values = await this.client.mget(keys);
    const result: Record<string, T | null> = {};

    keys.forEach((key, index) => {
      const value = values[index];

      if (value === null) {
        result[key] = null;
      } else {
        try {
          result[key] = JSON.parse(value) as T;
        } catch (e) {
          result[key] = value as unknown as T;
        }
      }
    });

    return result;
  }

  /**
   * Increment a numeric value in the cache
   *
   * @param key Cache key
   * @param increment Amount to increment (default: 1)
   * @returns New value after increment
   */
  async increment(key: string, increment: number = 1): Promise<number> {
    const newValue = await this.client.incrby(key, increment);

    // Ensure the key has an expiry
    const ttl = await this.client.ttl(key);
    if (ttl === -1) {
      // No expiry set
      await this.client.expire(key, this.defaultTTL);
    }

    return newValue;
  }

  /**
   * Get access to the underlying Redis client for advanced operations
   */
  getClient(): Redis {
    return this.client;
  }
}

export default IOValKeyCache;
