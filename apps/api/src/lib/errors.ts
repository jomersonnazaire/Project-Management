export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown, code = 'BAD_REQUEST') =>
  new HttpError(400, code, message, details);
export const unauthorized = (message = 'Please sign in.', code = 'UNAUTHENTICATED') =>
  new HttpError(401, code, message);
export const forbidden = (message = "You don't have permission to do this.", code = 'FORBIDDEN') =>
  new HttpError(403, code, message);
export const notFound = (message = 'Not found.') => new HttpError(404, 'NOT_FOUND', message);
export const conflict = (message: string, code = 'CONFLICT') => new HttpError(409, code, message);
