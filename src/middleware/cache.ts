import { Request, Response, NextFunction } from 'express';
import { redisClient } from '../config/redis.js';

export type KeyGenerator = (req: Request) => string;

export const cacheMiddleware = (ttl = 300, keyGenerator?: KeyGenerator) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void | Response> => {
    if (req.method !== 'GET') {
      return next();
    }

    try {
      let cacheKey: string;
      if (keyGenerator && typeof keyGenerator === 'function') {
        cacheKey = keyGenerator(req);
      } else {
        const baseKey = req.originalUrl || req.url;
        cacheKey = `route:${baseKey}`;
      }

      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('X-Cache-Key', cacheKey);
        return res.status(200).json(cachedData);
      }

      const originalJson = res.json.bind(res);
      res.setHeader('X-Cache', 'MISS');
      res.setHeader('X-Cache-Key', cacheKey);

      res.json = function (data: any) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          redisClient.set(cacheKey, data, ttl).catch(() => {
            // ignore cache set error
          });
        }
        return originalJson(data);
      };

      next();
    } catch (_error) {
      next();
    }
  };
};

export default cacheMiddleware;
