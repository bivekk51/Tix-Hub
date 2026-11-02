import { Router } from 'express';
import { create, getAll, getById, update, remove } from './eventController.js';
import { protect, adminOnly } from '../../middleware/auth.js';
import { cacheMiddleware } from '../../middleware/cache.js';

export const eventRoutes = Router();

eventRoutes.post('/', protect, adminOnly, create);
eventRoutes.get('/', cacheMiddleware(300), getAll);
eventRoutes.get('/:id', cacheMiddleware(1800), getById);
eventRoutes.put('/:id', protect, update);
eventRoutes.delete('/:id', protect, remove);

export default eventRoutes;
