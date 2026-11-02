import { Request, Response } from 'express';
import {
  createEvent,
  getAllEvents,
  getEventById,
  updateEvent,
  deleteEvent,
} from './eventService.js';
import {
  createEventSchema,
  updateEventSchema,
  eventQuerySchema,
} from './eventValidator.js';
import { sendSuccess } from '../../utils/response.js';
import { asyncHandler } from '../../middleware/error.js';

export const create = asyncHandler(async (req: Request, res: Response) => {
  const validatedData = createEventSchema.parse(req.body);
  const userId = req.user?.id || (req.user as any)?._id;
  const event = await createEvent(validatedData, userId);
  return sendSuccess(res, 201, event, 'Event created successfully');
});

export const getAll = asyncHandler(async (req: Request, res: Response) => {
  const validatedQuery = eventQuerySchema.parse(req.query);
  const events = await getAllEvents(validatedQuery);
  return sendSuccess(res, 200, events, 'Events retrieved successfully');
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const eventId = req.params.id as string;
  const event = await getEventById(eventId);
  return sendSuccess(res, 200, event, 'Event retrieved successfully');
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const eventId = req.params.id as string;
  const validatedData = updateEventSchema.parse(req.body);
  const userId = req.user?.id || (req.user as any)?._id;
  const userRole = req.user?.role || 'user';
  const event = await updateEvent(
    eventId,
    validatedData,
    userId,
    userRole
  );
  return sendSuccess(res, 200, event, 'Event updated successfully');
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  const eventId = req.params.id as string;
  const userId = req.user?.id || (req.user as any)?._id;
  const userRole = req.user?.role || 'user';
  const result = await deleteEvent(eventId, userId, userRole);
  return sendSuccess(res, 200, result, 'Event deleted successfully');
});
