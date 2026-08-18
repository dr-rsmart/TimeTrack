/**
 * Standardized Error Response Utilities
 * -------------------------------------
 * Consistent error response format across all API endpoints.
 * Provides detailed error messages with optional context for debugging.
 */

import type { Request, Response, NextFunction } from 'express';

export interface ErrorResponse {
  error: string;
  code?: string;
  details?: Record<string, unknown>;
  suggestions?: string[];
}

/**
 * Send a standardized error response.
 * @param res - Express response object
 * @param status - HTTP status code
 * @param message - Human-readable error message
 * @param options - Additional error context (code, details, suggestions)
 */
export function sendError(
  res: Response,
  status: number,
  message: string,
  options: { code?: string; details?: Record<string, unknown>; suggestions?: string[] } = {},
): void {
  const response: ErrorResponse = { error: message };
  if (options.code) response.code = options.code;
  if (options.details) response.details = options.details;
  if (options.suggestions && options.suggestions.length > 0) response.suggestions = options.suggestions;
  res.status(status).json(response);
}

// ── Common Error Helpers ──

export function notFound(res: Response, entity: string = 'Resource'): void {
  sendError(res, 404, `${entity} not found.`, { code: 'NOT_FOUND' });
}

export function unauthorized(res: Response, message: string = 'Authentication required.'): void {
  sendError(res, 401, message, { code: 'UNAUTHORIZED' });
}

export function accessDenied(res: Response, reason?: string): void {
  sendError(res, 403, reason || 'Access denied.', { code: 'ACCESS_DENIED' });
}

export function outsideScope(res: Response, entity: string = 'Employee'): void {
  sendError(res, 403, `${entity} is outside your management scope.`, { code: 'OUT_OF_SCOPE' });
}

export function badRequest(res: Response, message: string, details?: Record<string, unknown>): void {
  sendError(res, 400, message, { code: 'BAD_REQUEST', details });
}

export function conflict(res: Response, message: string, code: string = 'CONFLICT'): void {
  sendError(res, 409, message, { code });
}

export function internalError(res: Response, context?: string): void {
  const message = context
    ? `An unexpected error occurred while ${context}. Please try again.`
    : 'An unexpected error occurred. Please try again.';
  sendError(res, 500, message, { code: 'INTERNAL_ERROR' });
}

export function validationError(res: Response, message: string, details?: Record<string, unknown>): void {
  sendError(res, 422, message, { code: 'VALIDATION_ERROR', details });
}

export function badGateway(res: Response, message: string = 'Upstream service unavailable.'): void {
  sendError(res, 502, message, { code: 'BAD_GATEWAY' });
}

export function serviceUnavailable(res: Response, message: string = 'Service temporarily unavailable.'): void {
  sendError(res, 503, message, { code: 'SERVICE_UNAVAILABLE' });
}

// ── Domain-Specific Errors ──

export function shiftOverlap(res: Response, details?: { date?: string; startTime?: string; endTime?: string }): void {
  sendError(res, 409, 'This shift overlaps with an existing shift for the same employee.', {
    code: 'SHIFT_OVERLAP',
    details,
    suggestions: [
      'Check the employee\'s existing schedule for conflicts.',
      'Adjust the start or end time to avoid overlap.',
      'Cancel or reschedule the conflicting shift first.',
    ],
  });
}

export function alreadyClockedIn(res: Response, employeeName?: string): void {
  const name = employeeName ? ` ${employeeName}` : '';
  sendError(res, 409, `Employee${name} is already clocked in. Clock out before starting a new session.`, {
    code: 'ALREADY_CLOCKED_IN',
    suggestions: ['Clock out the current session before starting a new one.'],
  });
}

export function noActiveSession(res: Response): void {
  sendError(res, 404, 'No active clock-in session found.', {
    code: 'NO_ACTIVE_SESSION',
    suggestions: ['The employee may have already clocked out.', 'Verify the employee\'s current status.'],
  });
}

export function geofenceViolation(
  res: Response,
  options: {
    distanceMetres?: number;
    geofenceName?: string;
    radiusMetres?: number;
    suggestions?: string[];
  } = {},
): void {
  sendError(res, 403, 'You are outside your designated work location.', {
    code: 'GEOFENCE_VIOLATION',
    details: {
      distance_metres: options.distanceMetres,
      geofence_name: options.geofenceName,
      radius_metres: options.radiusMetres,
    },
    suggestions: options.suggestions || [
      'Move within the designated work area and try again.',
      'Contact your manager if you need to work from a different location.',
    ],
  });
}

export function duplicateRecord(res: Response, entity: string, field: string): void {
  sendError(res, 409, `A ${entity.toLowerCase()} with this ${field} already exists.`, {
    code: 'DUPLICATE_RECORD',
    details: { field },
  });
}

export function optimisticLockError(res: Response): void {
  sendError(res, 409, 'This record was modified by another user. Please refresh and try again.', {
    code: 'VERSION_CONFLICT',
    suggestions: ['Refresh the page to get the latest data.', 'Re-apply your changes to the updated record.'],
  });
}

// ── Express Middleware Handlers ──

/**
 * Express 404 handler for unmatched API routes.
 */
export function notFoundHandler(_req: Request, res: Response): void {
  notFound(res, 'Endpoint');
}

/**
 * Central Express error-handling middleware.
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error('[server] Unhandled error:', err);
  internalError(res);
}
