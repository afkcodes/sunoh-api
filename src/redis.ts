import Redis from 'ioredis';

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD,
  retryStrategy: (times) => Math.min(times * 50, 2000),
  enableOfflineQueue: false, // Fail fast if Redis is down
});

redis.on('error', (err) => console.error('Redis Client Error', err));
redis.on('connect', () => console.log('Redis Client Connected'));

export const cache = {
  set: async (key: string, value: any, ttl = 3600) => {
    try {
      if (value === undefined || value === null) return;
      await redis.set(key, JSON.stringify(value), 'EX', ttl);
    } catch (e) {
      console.error('Cache Set Error', e);
    }
  },
  get: async <T = any>(key: string): Promise<T | null> => {
    try {
      const data = await redis.get(key);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      console.error('Cache Get Error', e);
      return null;
    }
  },
  delete: async (key: string) => {
    try {
      return await redis.del(key);
    } catch (e) {
      console.error('Cache Delete Error', e);
      return 0;
    }
  },
  deleteMany: async (keys: string[]) => {
    try {
      if (keys.length === 0) return 0;
      return await redis.del(...keys);
    } catch (e) {
      console.error('Cache DeleteMany Error', e);
      return 0;
    }
  },
  deleteAll: async () => {
    try {
      return await redis.flushall();
    } catch (e) {
      console.error('Cache Flush Error', e);
      return 0;
    }
  },
  exists: async (key: string) => {
    try {
      return (await redis.exists(key)) === 1;
    } catch (e) {
      console.error('Cache Exists Error', e);
      return false;
    }
  },
  ttl: async (key: string) => {
    try {
      return await redis.ttl(key);
    } catch (e) {
      console.error('Cache TTL Error', e);
      return -1;
    }
  },
  setMany: async (entries: Record<string, any>, ttl = 3600) => {
    try {
      const pipeline = redis.pipeline();
      Object.entries(entries).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          pipeline.set(key, JSON.stringify(value), 'EX', ttl);
        }
      });
      await pipeline.exec();
    } catch (e) {
      console.error('Cache SetMany Error', e);
    }
  },
  getMany: async <T = any>(keys: string[]): Promise<(T | null)[]> => {
    try {
      if (keys.length === 0) return [];
      const data = await redis.mget(...keys);
      return data.map((item) => (item ? JSON.parse(item) : null));
    } catch (e) {
      console.error('Cache GetMany Error', e);
      return keys.map(() => null);
    }
  },
  increment: async (key: string, increment = 1) => {
    try {
      return await redis.incrby(key, increment);
    } catch (e) {
      console.error('Cache Increment Error', e);
      return 0;
    }
  },
  getClient: () => redis,
};
