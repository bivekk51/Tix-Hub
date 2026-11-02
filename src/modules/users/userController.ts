import { Request, Response } from 'express';
import { registerUser, loginUser } from './userService.js';
import { registerSchema, loginSchema } from './userValidator.js';
import { sendSuccess } from '../../utils/response.js';
import { asyncHandler } from '../../middleware/error.js';

export const register = asyncHandler(async (req: Request, res: Response) => {
  const validatedData = registerSchema.parse(req.body);
  const user = await registerUser(validatedData);
  return sendSuccess(res, 201, user, 'User registered successfully');
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const validatedData = loginSchema.parse(req.body);
  const user = await loginUser(validatedData.email, validatedData.password);
  return sendSuccess(res, 200, user, 'Login successful');
});
