import { describe, it, expect, vi } from 'vitest';
import { ZodError, z } from 'zod';
import {
  AppError,
  NotFoundError,
  ConflictError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
} from '../../src/utils/errors.js';
import { errorHandler, asyncHandler } from '../../src/middleware/error.js';

describe('Custom Errors', () => {
  it('should have correct status codes and operational flags', () => {
    const notFound = new NotFoundError();
    expect(notFound.statusCode).toBe(404);
    expect(notFound.message).toBe('Resource not found');
    expect(notFound.isOperational).toBe(true);

    const conflict = new ConflictError('conflict');
    expect(conflict.statusCode).toBe(409);
    expect(conflict.message).toBe('conflict');
    expect(conflict.isOperational).toBe(true);

    const validation = new ValidationError('invalid');
    expect(validation.statusCode).toBe(400);
    expect(validation.message).toBe('invalid');
    expect(validation.isOperational).toBe(true);

    const auth = new AuthenticationError();
    expect(auth.statusCode).toBe(401);
    expect(auth.message).toBe('Authentication failed');
    expect(auth.isOperational).toBe(true);

    const forbidden = new AuthorizationError();
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.message).toBe('Access denied');
    expect(forbidden.isOperational).toBe(true);
  });
});

describe('Error Middleware', () => {
  const mockResponse = () => {
    const res: any = {};
    res.statusCode = 200;
    res.jsonData = null;
    res.status = vi.fn().mockImplementation((code: number) => {
      res.statusCode = code;
      return res;
    });
    res.json = vi.fn().mockImplementation((data: any) => {
      res.jsonData = data;
      return res;
    });
    return res;
  };

  it('should handle ZodError with 400 and validation details', () => {
    const schema = z.object({ name: z.string() });
    let zodErr: ZodError | null = null;
    try {
      schema.parse({});
    } catch (e: any) {
      zodErr = e;
    }

    const req: any = {};
    const res = mockResponse();
    const next = vi.fn();

    errorHandler(zodErr, req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.jsonData.success).toBe(false);
    expect(res.jsonData.message).toBe('Validation failed');
    expect(res.jsonData.errors).toBeDefined();
    expect(res.jsonData.errors[0].field).toBe('name');
  });

  it('should handle Postgres 23505 unique violation with 409', () => {
    const pgErr: any = new Error('duplicate key');
    pgErr.code = '23505';

    const req: any = {};
    const res = mockResponse();
    const next = vi.fn();

    errorHandler(pgErr, req, res, next);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.jsonData.success).toBe(false);
    expect(res.jsonData.message).toBe('Resource already exists');
  });

  it('should handle Postgres 23503 foreign key violation with 400', () => {
    const pgErr: any = new Error('violates foreign key constraint');
    pgErr.code = '23503';

    const req: any = {};
    const res = mockResponse();
    const next = vi.fn();

    errorHandler(pgErr, req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.jsonData.success).toBe(false);
    expect(res.jsonData.message).toBe('Referenced resource does not exist');
  });

  it('should handle JsonWebTokenError with 401', () => {
    const jwtErr: any = new Error('invalid signature');
    jwtErr.name = 'JsonWebTokenError';

    const req: any = {};
    const res = mockResponse();
    const next = vi.fn();

    errorHandler(jwtErr, req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.jsonData.success).toBe(false);
    expect(res.jsonData.message).toBe('Invalid token');
  });

  it('should handle TokenExpiredError with 401', () => {
    const expErr: any = new Error('jwt expired');
    expErr.name = 'TokenExpiredError';

    const req: any = {};
    const res = mockResponse();
    const next = vi.fn();

    errorHandler(expErr, req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.jsonData.success).toBe(false);
    expect(res.jsonData.message).toBe('Token expired');
  });

  it('should handle custom AppError with its statusCode', () => {
    const customErr = new NotFoundError('Ticket not found');

    const req: any = {};
    const res = mockResponse();
    const next = vi.fn();

    errorHandler(customErr, req, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.jsonData.success).toBe(false);
    expect(res.jsonData.message).toBe('Ticket not found');
  });

  it('should default to 500 Internal server error for unhandled errors', () => {
    const randomErr = new Error('Something went wrong');

    const req: any = {};
    const res = mockResponse();
    const next = vi.fn();

    errorHandler(randomErr, req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.jsonData.success).toBe(false);
    expect(res.jsonData.message).toBe('Something went wrong');
  });

  it('asyncHandler should catch promise rejections and forward to next', async () => {
    const error = new Error('Async failure');
    const asyncFn = async () => {
      throw error;
    };
    const handler = asyncHandler(asyncFn);

    const req: any = {};
    const res: any = {};
    const next = vi.fn();

    handler(req, res, next);
    await new Promise((r) => setTimeout(r, 10));
    expect(next).toHaveBeenCalledWith(error);
  });
});

describe('Auth Middleware', () => {
  it('adminOnly allows admin user', async () => {
    const { adminOnly } = await import('../../src/middleware/auth.js');
    const req: any = { user: { role: 'admin' } };
    const res: any = {};
    const next = vi.fn();

    adminOnly(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('adminOnly blocks non-admin user', async () => {
    const { adminOnly } = await import('../../src/middleware/auth.js');
    const req: any = { user: { role: 'user' } };
    const res: any = {};
    const next = vi.fn();

    expect(() => adminOnly(req, res, next)).toThrow(AuthorizationError);
  });

  it('adminOnly blocks unauthenticated user', async () => {
    const { adminOnly } = await import('../../src/middleware/auth.js');
    const req: any = {};
    const res: any = {};
    const next = vi.fn();

    expect(() => adminOnly(req, res, next)).toThrow(AuthorizationError);
  });

  it('protect blocks request without authorization header', async () => {
    const { protect } = await import('../../src/middleware/auth.js');
    const req: any = { headers: {} };
    const res: any = {};
    const next = vi.fn();

    await protect(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(AuthenticationError));
  });

  it('protect blocks request with invalid token format', async () => {
    const { protect } = await import('../../src/middleware/auth.js');
    const req: any = { headers: { authorization: 'Basic 12345' } };
    const res: any = {};
    const next = vi.fn();

    await protect(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(AuthenticationError));
  });

  it('protect verifies valid token and loads user from redis cache', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    const { protect } = await import('../../src/middleware/auth.js');
    const { redisClient } = await import('../../src/config/redis.js');
    const { env } = await import('../../src/config/env.js');

    const cachedUser = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      name: 'Alice',
      email: 'alice@example.com',
      role: 'user' as const,
    };

    vi.spyOn(redisClient, 'get').mockResolvedValueOnce(cachedUser);

    const token = jwt.sign({ id: cachedUser.id }, env.JWT_SECRET);
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    const res: any = {};
    const next = vi.fn();

    await protect(req, res, next);
    expect(req.user).toEqual(cachedUser);
    expect(next).toHaveBeenCalledWith();
  });

  it('protect queries db and caches user when not in redis', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    const { protect } = await import('../../src/middleware/auth.js');
    const { redisClient } = await import('../../src/config/redis.js');
    const { env } = await import('../../src/config/env.js');
    const { db } = await import('../../src/db/index.js');

    const dbUser = {
      id: '223e4567-e89b-12d3-a456-426614174001',
      name: 'Bob',
      email: 'bob@example.com',
      role: 'admin' as const,
    };

    vi.spyOn(redisClient, 'get').mockResolvedValueOnce(null);
    const setSpy = vi.spyOn(redisClient, 'set').mockResolvedValueOnce(true);
    vi.spyOn(db, 'select').mockReturnValueOnce({
      from: () => ({
        where: () => Promise.resolve([dbUser]),
      }),
    } as any);

    const token = jwt.sign({ id: dbUser.id }, env.JWT_SECRET);
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    const res: any = {};
    const next = vi.fn();

    await protect(req, res, next);
    expect(req.user).toEqual(dbUser);
    expect(setSpy).toHaveBeenCalledWith(`user:${dbUser.id}`, dbUser, 3600);
    expect(next).toHaveBeenCalledWith();
  });
});

describe('Redis Client Offline Fallback', () => {
  it('should safely return fallback values when disconnected', async () => {
    const { redisClient } = await import('../../src/config/redis.js');
    expect(redisClient.isConnected).toBe(false);

    expect(await redisClient.get('any-key')).toBeNull();
    expect(await redisClient.set('any-key', 'val')).toBe(false);
    expect(await redisClient.del('any-key')).toBe(false);
    expect(await redisClient.delPattern('any:*')).toBe(false);
    expect(await redisClient.exists('any-key')).toBe(false);
    expect(await redisClient.incr('any-key')).toBe(0);

    const rate = await redisClient.rateLimit('rate:key', 10, 60);
    expect(rate.allowed).toBe(true);
    expect(rate.remaining).toBe(10);

    await expect(redisClient.invalidateEvent('evt-123')).resolves.not.toThrow();
    expect(await redisClient.invalidateEventAvailability('evt-123')).toBe(false);
    expect(await redisClient.invalidateEventLists()).toBe(false);
  });
});
