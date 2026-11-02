import { Response } from 'express';

export const serializeEntity = <T>(entity: T): T => {
  if (!entity || typeof entity !== 'object') {
    return entity;
  }

  if (entity instanceof Date || entity instanceof RegExp) {
    return entity;
  }

  if (Array.isArray(entity)) {
    return entity.map((item) => serializeEntity(item)) as unknown as T;
  }

  const record = entity as Record<string, any>;
  const result: Record<string, any> = {};

  for (const [key, value] of Object.entries(record)) {
    result[key] = serializeEntity(value);
  }

  if ('id' in result && !('_id' in result)) {
    result._id = result.id;
  }

  return result as T;
};

export const sendSuccess = (
  res: Response,
  statusCode: number,
  data: any,
  message = 'Success'
) => {
  const serialized = serializeEntity(data);

  return res.status(statusCode).json({
    success: true,
    message,
    data: serialized,
  });
};

export const sendError = (res: Response, statusCode: number, message: string) => {
  return res.status(statusCode).json({
    success: false,
    message,
  });
};
