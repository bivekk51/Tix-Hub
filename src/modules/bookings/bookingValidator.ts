import { z } from 'zod';

export const createBookingSchema = z.object({
  eventId: z.string().uuid('Invalid event ID format'),
  quantity: z
    .number()
    .int()
    .min(1, 'Quantity must be at least 1')
    .max(100, 'Cannot book more than 100 tickets at once'),
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
