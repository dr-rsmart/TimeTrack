import { describe, it, expect, vi } from 'vitest';
type Response = any;
import {
  sendError,
  badRequest,
  unauthorized,
  accessDenied,
  outsideScope,
  notFound,
  conflict,
  internalError,
  geofenceViolation,
  alreadyClockedIn,
  noActiveSession,
  duplicateRecord,
  optimisticLockError,
} from '../../server/src/errorResponse.js';

function createMockResponse() {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

describe('Standardized Error Response Unit Tests', () => {
  it('sendError formats standard payload with error, code, details, suggestions', () => {
    const res = createMockResponse();
    sendError(res, 400, 'Custom error', {
      code: 'CUSTOM_CODE',
      details: { key: 'val' },
      suggestions: ['Try this'],
    });

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Custom error',
      code: 'CUSTOM_CODE',
      details: { key: 'val' },
      suggestions: ['Try this'],
    });
  });

  it('unauthorized returns 401 with UNAUTHORIZED code', () => {
    const res = createMockResponse();
    unauthorized(res, 'Invalid credentials');
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Invalid credentials',
      code: 'UNAUTHORIZED',
    });
  });

  it('accessDenied returns 403 with ACCESS_DENIED code', () => {
    const res = createMockResponse();
    accessDenied(res, 'Forbidden');
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Forbidden',
      code: 'ACCESS_DENIED',
    });
  });

  it('outsideScope returns 403 with OUT_OF_SCOPE code', () => {
    const res = createMockResponse();
    outsideScope(res, 'Employee');
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Employee is outside your management scope.',
      code: 'OUT_OF_SCOPE',
    });
  });

  it('notFound returns 404 with NOT_FOUND code', () => {
    const res = createMockResponse();
    notFound(res, 'Shift');
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Shift not found.',
      code: 'NOT_FOUND',
    });
  });

  it('conflict returns 409 with specified code', () => {
    const res = createMockResponse();
    conflict(res, 'Resource exists', 'ALREADY_EXISTS');
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Resource exists',
      code: 'ALREADY_EXISTS',
    });
  });

  it('internalError returns 500 with INTERNAL_ERROR code', () => {
    const res = createMockResponse();
    internalError(res, 'processing payroll');
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'An unexpected error occurred while processing payroll. Please try again.',
      code: 'INTERNAL_ERROR',
    });
  });

  it('geofenceViolation returns 403 with distance and radius details', () => {
    const res = createMockResponse();
    geofenceViolation(res, {
      distanceMetres: 250,
      geofenceName: 'Head Office',
      radiusMetres: 100,
    });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'You are outside your designated work location.',
      code: 'GEOFENCE_VIOLATION',
      details: {
        distance_metres: 250,
        geofence_name: 'Head Office',
        radius_metres: 100,
      },
    }));
  });

  it('alreadyClockedIn returns 409 with suggestions', () => {
    const res = createMockResponse();
    alreadyClockedIn(res, 'John Doe');
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'Employee John Doe is already clocked in. Clock out before starting a new session.',
      code: 'ALREADY_CLOCKED_IN',
    }));
  });

  it('noActiveSession returns 404 with NO_ACTIVE_SESSION code', () => {
    const res = createMockResponse();
    noActiveSession(res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'NO_ACTIVE_SESSION',
    }));
  });

  it('duplicateRecord returns 409 with DUPLICATE_RECORD code and field detail', () => {
    const res = createMockResponse();
    duplicateRecord(res, 'Employee', 'email');
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: 'A employee with this email already exists.',
      code: 'DUPLICATE_RECORD',
      details: { field: 'email' },
    });
  });

  it('optimisticLockError returns 409 with VERSION_CONFLICT code', () => {
    const res = createMockResponse();
    optimisticLockError(res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'VERSION_CONFLICT',
    }));
  });
});
