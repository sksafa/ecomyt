export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, "BAD_REQUEST", message, details);
export const validationError = (details: unknown, message = "Validation failed") =>
  new AppError(422, "VALIDATION_ERROR", message, details);
export const unauthorized = (message = "Authentication required") => new AppError(401, "UNAUTHORIZED", message);
export const forbidden = (message = "You do not have permission to perform this action") =>
  new AppError(403, "FORBIDDEN", message);
export const notFound = (entity = "Resource") => new AppError(404, "NOT_FOUND", `${entity} not found`);
export const conflict = (message: string, details?: unknown) => new AppError(409, "CONFLICT", message, details);
export const unprocessable = (code: string, message: string, details?: unknown) =>
  new AppError(422, code, message, details);
export const tooMany = (message = "Too many requests, please try again later") =>
  new AppError(429, "RATE_LIMITED", message);
export const unavailable = (message: string) => new AppError(503, "UNAVAILABLE", message);

export function assertFound<T>(value: T | null | undefined, entity?: string): T {
  if (value === null || value === undefined) throw notFound(entity);
  return value;
}
