import { createClient } from 'redis';
import { env } from './env.js';

export class RedisClient {
  public client: ReturnType<typeof createClient> | null = null;
  public isConnected = false;

  async connect() {
    try {
      this.client = createClient({
        socket: {
          host: env.REDIS_HOST,
          port: env.REDIS_PORT,
          reconnectStrategy: (retries: number) => {
            if (retries > 3) {
              return false;
            }
            return Math.min(retries * 50, 500);
          },
        },
      });

      this.client.on('ready', () => {
        this.isConnected = true;
      });

      this.client.on('error', (_err) => {
        this.isConnected = false;
      });

      this.client.on('end', () => {
        this.isConnected = false;
      });

      await this.client.connect();
      return this.client;
    } catch (_error) {
      this.isConnected = false;
      return null;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client && (this.isConnected || this.client.isOpen)) {
      try {
        await this.client.quit();
      } catch {
        // ignore disconnect errors
      } finally {
        this.isConnected = false;
      }
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.isConnected || !this.client) return null;
    try {
      const result = await this.client.get(key);
      return result ? (JSON.parse(result) as T) : null;
    } catch (_error) {
      return null;
    }
  }

  async set(key: string, value: any, ttl = 3600): Promise<boolean> {
    if (!this.isConnected || !this.client) return false;
    try {
      await this.client.setEx(key, ttl, JSON.stringify(value));
      return true;
    } catch (_error) {
      return false;
    }
  }

  async del(key: string | string[]): Promise<boolean> {
    if (!this.isConnected || !this.client) return false;
    try {
      await this.client.del(key);
      return true;
    } catch (_error) {
      return false;
    }
  }

  async delPattern(pattern: string): Promise<boolean> {
    if (!this.isConnected || !this.client) return false;
    try {
      const keys: string[] = [];
      if (typeof this.client.scanIterator === 'function') {
        for await (const chunk of this.client.scanIterator({ MATCH: pattern, COUNT: 100 })) {
          if (Array.isArray(chunk)) {
            keys.push(...(chunk as string[]));
          } else if (typeof chunk === 'string') {
            keys.push(chunk);
          }
        }
      } else {
        const found = await this.client.keys(pattern);
        keys.push(...found);
      }
      if (keys.length > 0) {
        await this.client.del(keys);
      }
      return true;
    } catch (_error) {
      return false;
    }
  }

  async exists(key: string): Promise<boolean> {
    if (!this.isConnected || !this.client) return false;
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (_error) {
      return false;
    }
  }

  async incr(key: string, ttl = 3600): Promise<number> {
    if (!this.isConnected || !this.client) return 0;
    try {
      const result = await this.client.incr(key);
      if (result === 1) {
        await this.client.expire(key, ttl);
      }
      return result;
    } catch (_error) {
      return 0;
    }
  }

  // Helper methods
  async invalidateEvent(eventId: string): Promise<void> {
    await Promise.all([
      this.del(`event:${eventId}`),
      this.del(`availability:${eventId}`),
      this.delPattern('events:*'),
      this.delPattern('route:/api/v1/events*'),
    ]);
  }

  async invalidateEventAvailability(eventId: string): Promise<boolean> {
    return await this.del(`availability:${eventId}`);
  }

  async invalidateEventLists(): Promise<boolean> {
    const results = await Promise.all([
      this.delPattern('events:*'),
      this.delPattern('route:/api/v1/events*'),
    ]);
    return results.every(Boolean);
  }

  async cacheEvent(eventId: string, eventData: any, ttl = 1800): Promise<boolean> {
    return await this.set(`event:${eventId}`, eventData, ttl);
  }

  async getCachedEvent<T = any>(eventId: string): Promise<T | null> {
    return await this.get<T>(`event:${eventId}`);
  }

  async cacheEventList(filterKey: string, events: any, ttl = 300): Promise<boolean> {
    return await this.set(`events:${filterKey}`, events, ttl);
  }

  async getCachedEventList<T = any>(filterKey: string): Promise<T | null> {
    return await this.get<T>(`events:${filterKey}`);
  }

  async cacheUser(userId: string, userData: any, ttl = 3600): Promise<boolean> {
    return await this.set(`user:${userId}`, userData, ttl);
  }

  async getCachedUser<T = any>(userId: string): Promise<T | null> {
    return await this.get<T>(`user:${userId}`);
  }

  async invalidateUser(userId: string): Promise<boolean> {
    return await this.del(`user:${userId}`);
  }

  async cacheEventAvailability(eventId: string, availabilityData: any, ttl = 60): Promise<boolean> {
    return await this.set(`availability:${eventId}`, availabilityData, ttl);
  }

  async getCachedEventAvailability<T = any>(eventId: string): Promise<T | null> {
    return await this.get<T>(`availability:${eventId}`);
  }

  async rateLimit(key: string, limit: number, window: number): Promise<{
    allowed: boolean;
    remaining: number;
    resetTime: number;
  }> {
    if (!this.isConnected || !this.client) {
      return { allowed: true, remaining: limit, resetTime: Date.now() + window * 1000 };
    }
    try {
      const current = await this.incr(key, window);
      const remaining = Math.max(0, limit - current);
      return {
        allowed: current <= limit,
        remaining,
        resetTime: Date.now() + window * 1000,
      };
    } catch (_error) {
      return { allowed: true, remaining: limit, resetTime: Date.now() + window * 1000 };
    }
  }
}

export const redisClient = new RedisClient();
export default redisClient;
