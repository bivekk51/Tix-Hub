import { Response } from 'express';

export const serializeEntity = <T>(entity: T): T => {
  if (!entity || typeof entity !== 'object') {
    return entity;
  }

  if (Array.isArray(entity)) {
    return entity.map((item) => serializeEntity(item)) as unknown as T;
  }

  const record = entity as Record<string, any>;
  if ('id' in record && !('_id' in record)) {
    return {
      ...record,
      _id: record.id,
    } as T;
  }

  return entity;
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
