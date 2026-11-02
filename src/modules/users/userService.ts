import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { users } from '../../db/schema/index.js';
import { env } from '../../config/env.js';
import { ConflictError, AuthenticationError } from '../../utils/errors.js';
import { RegisterInput } from './userValidator.js';

export interface AuthResponse {
  id: string;
  _id: string;
  name: string;
  email: string;
  role: 'user' | 'admin';
  token: string;
}

const generateToken = (id: string): string => {
  return jwt.sign({ id }, env.JWT_SECRET, { expiresIn: '30d' });
};

export const registerUser = async (data: RegisterInput): Promise<AuthResponse> => {
  const existingUsers = await db
    .select()
    .from(users)
    .where(eq(users.email, data.email));

  if (existingUsers && existingUsers.length > 0) {
    throw new ConflictError('User already exists');
  }

  const hashedPassword = await bcrypt.hash(data.password, 10);
  const role = data.role ?? 'user';

  const [createdUser] = await db
    .insert(users)
    .values({
      name: data.name,
      email: data.email,
      password: hashedPassword,
      role,
    })
    .returning();

  const token = generateToken(createdUser.id);

  return {
    id: createdUser.id,
    _id: createdUser.id,
    name: createdUser.name,
    email: createdUser.email,
    role: createdUser.role,
    token,
  };
};

export const loginUser = async (email: string, pass: string): Promise<AuthResponse> => {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email));

  if (!user) {
    throw new AuthenticationError('Invalid credentials');
  }

  const isMatch = await bcrypt.compare(pass, user.password);
  if (!isMatch) {
    throw new AuthenticationError('Invalid credentials');
  }

  const token = generateToken(user.id);

  return {
    id: user.id,
    _id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    token,
  };
};
