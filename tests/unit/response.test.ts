import { describe, it, expect } from 'vitest';
import { serializeEntity, sendSuccess } from '../../src/utils/response.js';

describe('Response Serialization', () => {
  it('should include both id and alias _id for backward compatibility', () => {
    const entity = { id: '123e4567-e89b-12d3-a456-426614174000', name: 'Rock Fest' };
    const serialized = serializeEntity(entity);
    expect(serialized).toBeDefined();
    expect(serialized!.id).toBe(entity.id);
    expect(serialized!._id).toBe(entity.id);
    expect(serialized!.name).toBe('Rock Fest');
  });

  it('should handle null or non-object values gracefully', () => {
    expect(serializeEntity(null)).toBeNull();
    expect(serializeEntity(undefined)).toBeUndefined();
    expect(serializeEntity('string' as any)).toBe('string');
    expect(serializeEntity(123 as any)).toBe(123);
  });

  it('should handle arrays of entities', () => {
    const list = [
      { id: 'id-1', name: 'Item 1' },
      { id: 'id-2', name: 'Item 2' },
    ];
    const serialized = serializeEntity(list);
    expect(Array.isArray(serialized)).toBe(true);
    expect(serialized![0]._id).toBe('id-1');
    expect(serialized![1]._id).toBe('id-2');
  });

  it('should not overwrite existing _id if present', () => {
    const entity = { id: 'id-1', _id: 'custom-id', name: 'Item' };
    const serialized = serializeEntity(entity);
    expect(serialized!._id).toBe('custom-id');
  });

  it('should recursively alias _id on nested entity objects and preserve Date instances', () => {
    const testDate = new Date('2026-12-01T20:00:00.000Z');
    const booking = {
      id: 'ticket-1',
      quantity: 2,
      createdAt: testDate,
      event: {
        id: 'event-1',
        name: 'Concert',
        date: testDate,
      },
    };
    const serialized = serializeEntity(booking);
    expect(serialized.id).toBe('ticket-1');
    expect(serialized._id).toBe('ticket-1');
    expect(serialized.createdAt).toBe(testDate);
    expect(serialized.event.id).toBe('event-1');
    expect(serialized.event._id).toBe('event-1');
    expect(serialized.event.date).toBe(testDate);
  });

  it('should send formatted JSON success response', () => {
    const res: any = {
      statusCode: 200,
      jsonData: null,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(data: any) {
        this.jsonData = data;
        return this;
      },
    };

    sendSuccess(res, 200, { id: 'abc-123', title: 'Concert' }, 'Fetched successfully');
    expect(res.statusCode).toBe(200);
    expect(res.jsonData.success).toBe(true);
    expect(res.jsonData.message).toBe('Fetched successfully');
    expect(res.jsonData.data.id).toBe('abc-123');
    expect(res.jsonData.data._id).toBe('abc-123');
  });
});
