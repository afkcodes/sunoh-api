import { FastifyReply } from 'fastify';

export interface ApiResponse<T> {
  status: 'success' | 'failed';
  message: string;
  data: T | null;
  error: any | null;
  source?: string;
}

export const sendSuccess = <T>(
  res: FastifyReply,
  data: T,
  message = 'Request successful',
  source = 'api',
  code = 200,
) => {
  const response: ApiResponse<T> = {
    status: 'success',
    message,
    data,
    error: null,
    source,
  };
  return res.code(code).send(response);
};

export const sendError = (
  res: FastifyReply,
  message = 'Request failed',
  error: any = null,
  code = 400,
) => {
  const response: ApiResponse<null> = {
    status: 'failed',
    message,
    data: null,
    error,
  };
  return res.code(code).send(response);
};
