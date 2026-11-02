import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { env } from '../config/env.js';
import { db } from '../db/index.js';
import { users } from '../db/schema/index.js';
import { AuthenticationError, AuthorizationError } from '../utils/errors.js';
import { asyncHandler } from './error.js';
import { redisClient } from '../config/redis.js';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'user' | 'admin';
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const protect = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AuthenticationError('Not authorized, no token provided');
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      throw new AuthenticationError('Not authorized, no token provided');
    }

    let decoded: { id: string };
    try {
      decoded = jwt.verify(token, env.JWT_SECRET) as { id: string };
    } catch (error: any) {
      if (error.name === 'JsonWebTokenError') {
        throw new AuthenticationError('Invalid token');
      }
      if (error.name === 'TokenExpiredError') {
        throw new AuthenticationError('Token expired');
      }
      throw error;
    }

    let user = await redisClient.get<AuthUser>(`user:${decoded.id}`);
    if (!user) {
      const [dbUser] = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          role: users.role,
        })
        .from(users)
        .where(eq(users.id, decoded.id));

      if (!dbUser) {
        throw new AuthenticationError('User not found');
      }

      user = dbUser;
      await redisClient.set(`user:${decoded.id}`, user, 3600);
    }

    req.user = user;
    next();
  }
);

export const adminOnly = (req: Request, _res: Response, next: NextFunction) => {
  if (req.user && req.user.role === 'admin') {
    return next();
  }
  throw new AuthorizationError('Access denied, admin only');
};
