import { Router } from 'express';
import { register, login } from './userController.js';

export const userRoutes = Router();

userRoutes.post('/register', register);
userRoutes.post('/login', login);

export default userRoutes;
