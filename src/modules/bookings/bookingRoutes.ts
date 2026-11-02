import { Router } from 'express';
import {
  create,
  confirm,
  cancel,
  getUserBookingsList,
  getById,
} from './bookingController.js';
import { protect } from '../../middleware/auth.js';

export const bookingRoutes = Router();

bookingRoutes.post('/', protect, create);
bookingRoutes.post('/:id/confirm', protect, confirm);
bookingRoutes.post('/:id/cancel', protect, cancel);
bookingRoutes.get('/', protect, getUserBookingsList);
bookingRoutes.get('/:id', protect, getById);

export default bookingRoutes;
