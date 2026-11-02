import { z } from 'zod';

export const createEventSchema = z.object({
  name: z.string().min(3, 'Event name must be at least 3 characters').max(255, 'Event name must not exceed 255 characters'),
  description: z.string().min(10, 'Description must be at least 10 characters'),
  date: z.string().datetime('Invalid date format').or(z.date()),
  location: z.string().min(3, 'Location must be at least 3 characters').max(255, 'Location must not exceed 255 characters'),
  totalTickets: z.number().int().min(1, 'Total tickets must be at least 1').max(1000000, 'Total tickets exceeds maximum'),
  price: z.number().min(0, 'Price cannot be negative').max(1000000, 'Price exceeds maximum'),
});

export const updateEventSchema = createEventSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
  });

export const eventQuerySchema = z.object({
  date: z.string().optional(),
  location: z.string().optional(),
});

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
export type EventQueryInput = z.infer<typeof eventQuerySchema>;
