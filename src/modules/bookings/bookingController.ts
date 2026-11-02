import { Request, Response } from 'express';
import {
  createBooking,
  confirmBooking,
  cancelBooking,
  getUserBookings,
  getBookingById,
} from './bookingService.js';
import { createBookingSchema } from './bookingValidator.js';
import { asyncHandler } from '../../middleware/error.js';
import { sendSuccess } from '../../utils/response.js';

export const create = asyncHandler(async (req: Request, res: Response) => {
  const validated = createBookingSchema.parse(req.body);
  const userId = req.user?.id || (req.user as any)?._id;
  const booking = await createBooking(validated.eventId, userId, validated.quantity);
  return sendSuccess(res, 201, booking, 'Booking created successfully');
});

export const confirm = asyncHandler(async (req: Request, res: Response) => {
  const bookingId = req.params.id as string;
  const userId = req.user?.id || (req.user as any)?._id;
  const booking = await confirmBooking(bookingId, userId);
  return sendSuccess(res, 200, booking, 'Booking confirmed successfully');
});

export const cancel = asyncHandler(async (req: Request, res: Response) => {
  const bookingId = req.params.id as string;
  const userId = req.user?.id || (req.user as any)?._id;
  const booking = await cancelBooking(bookingId, userId);
  return sendSuccess(res, 200, booking, 'Booking cancelled successfully');
});

export const getUserBookingsList = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || (req.user as any)?._id;
  const bookings = await getUserBookings(userId);
  return sendSuccess(res, 200, bookings, 'User bookings retrieved successfully');
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const bookingId = req.params.id as string;
  const userId = req.user?.id || (req.user as any)?._id;
  const booking = await getBookingById(bookingId, userId);
  return sendSuccess(res, 200, booking, 'Booking retrieved successfully');
});
