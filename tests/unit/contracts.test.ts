import { describe, expect, it } from 'vitest';
import {
  API_ERROR_CODE,
  ATTENDANCE_ACTION,
  ATTENDANCE_STATUS,
  EMPLOYEE_STATUS,
  ROLE,
  SHIFT_STATUS,
  SHIFT_TYPE,
} from '../../contracts/index.js';

describe('shared wire contracts', () => {
  it('exports the role and lifecycle values used by API payloads', () => {
    expect(Object.values(ROLE)).toEqual(['master', 'admin', 'manager', 'employee']);
    expect(Object.values(EMPLOYEE_STATUS)).toEqual(['active', 'suspended', 'terminated']);
    expect(Object.values(SHIFT_STATUS)).toEqual(['scheduled', 'active', 'completed', 'cancelled', 'no_show']);
    expect(Object.values(SHIFT_TYPE)).toEqual(['full_day', 'half_day', 'Holiday', 'Leave', 'Sick', 'PTO', 'Unpaid']);
  });

  it('keeps attendance actions/statuses and standard error codes stable', () => {
    expect(ATTENDANCE_STATUS).toEqual({ ACTIVE: 'active', COMPLETED: 'completed' });
    expect(ATTENDANCE_ACTION).toEqual({
      CLOCK_IN: 'clock_in',
      CLOCK_OUT: 'clock_out',
      FORCE_CLOCK_OUT: 'force_clock_out',
      MANUAL_CREATE: 'manual_create',
      MANUAL_ADJUST: 'manual_adjust',
      DELETE: 'delete',
    });
    expect(API_ERROR_CODE.GEOFENCE_VIOLATION).toBe('GEOFENCE_VIOLATION');
    expect(API_ERROR_CODE.VERSION_CONFLICT).toBe('VERSION_CONFLICT');
  });
});