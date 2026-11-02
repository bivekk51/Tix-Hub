import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerUser, loginUser } from '../../src/modules/users/userService.js';
import { ConflictError, AuthenticationError } from '../../src/utils/errors.js';
import { db } from '../../src/db/index.js';
import bcrypt from 'bcryptjs';

vi.mock('../../src/db/index.js', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
  },
}));

describe('User Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should throw ConflictError if user email already exists', async () => {
    (db.select as any).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 'existing-id', email: 'test@example.com' }]),
      }),
    });

    await expect(registerUser({
      name: 'Test User',
      email: 'test@example.com',
      password: 'password123',
    })).rejects.toThrow(ConflictError);
  });

  it('should successfully register a new user and return a token', async () => {
    (db.select as any).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const mockCreatedUser = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      name: 'Test User',
      email: 'test@example.com',
      role: 'user',
      createdAt: new Date(),
    };

    (db.insert as any).mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([mockCreatedUser]),
      }),
    });

    const result = await registerUser({
      name: 'Test User',
      email: 'test@example.com',
      password: 'password123',
    });

    expect(result.id).toBe(mockCreatedUser.id);
    expect(result._id).toBe(mockCreatedUser.id);
    expect(result.name).toBe(mockCreatedUser.name);
    expect(result.token).toBeDefined();
  });

  it('should throw AuthenticationError on invalid login password', async () => {
    const hashedPassword = await bcrypt.hash('correctpassword', 10);
    (db.select as any).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{
          id: '123e4567-e89b-12d3-a456-426614174000',
          name: 'Test User',
          email: 'test@example.com',
          password: hashedPassword,
          role: 'user',
        }]),
      }),
    });

    await expect(loginUser('test@example.com', 'wrongpassword')).rejects.toThrow(AuthenticationError);
  });

  it('should throw AuthenticationError if user is not found on login', async () => {
    (db.select as any).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    await expect(loginUser('notfound@example.com', 'password123')).rejects.toThrow(AuthenticationError);
  });

  it('should successfully login and return token', async () => {
    const hashedPassword = await bcrypt.hash('correctpassword', 10);
    (db.select as any).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{
          id: '123e4567-e89b-12d3-a456-426614174000',
          name: 'Test User',
          email: 'test@example.com',
          password: hashedPassword,
          role: 'user',
        }]),
      }),
    });

    const result = await loginUser('test@example.com', 'correctpassword');
    expect(result.id).toBe('123e4567-e89b-12d3-a456-426614174000');
    expect(result._id).toBe('123e4567-e89b-12d3-a456-426614174000');
    expect(result.token).toBeDefined();
  });
});
