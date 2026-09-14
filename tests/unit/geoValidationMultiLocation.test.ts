import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMocks = vi.hoisted(() => ({
  employeeFindFirst: vi.fn(),
  geofenceFindMany: vi.fn(),
}));

vi.mock('../../server/src/prisma.js', () => ({
  default: {
    employee: { findFirst: prismaMocks.employeeFindFirst },
    geofence: { findMany: prismaMocks.geofenceFindMany },
  },
}));

import {
  validateClockInLocation,
  validateClockOutLocation,
  type GeoPosition,
} from '../../server/src/geoValidationService.js';

const LOCATION_ONE = {
  id: 'location-one',
  name: 'Head Office',
  address: '1 Main Road',
  latitude: -33.9249,
  longitude: 18.4241,
  radiusMeters: 300,
  isActive: true,
};

const LOCATION_TWO = {
  id: 'location-two',
  name: 'Branch Office',
  address: '2 Branch Road',
  latitude: -33.9,
  longitude: 18.45,
  radiusMeters: 300,
  isActive: true,
};

const UNRELATED_LOCATION = {
  id: 'unrelated-location',
  name: 'Unrelated Site',
  address: '99 Other Road',
  latitude: -34.1,
  longitude: 18.6,
  radiusMeters: 300,
  isActive: true,
};

const employeeWithAssignments = {
  id: 'employee-1',
  geofenceId: LOCATION_ONE.id,
  companyProfileId: 'company-1',
  geofence: LOCATION_ONE,
  employeeGeofences: [{ geofence: LOCATION_TWO }],
};

function positionAt(location: typeof LOCATION_ONE): GeoPosition {
  return { latitude: location.latitude, longitude: location.longitude };
}

describe('multi-location geofence validation', () => {
  beforeEach(() => {
    prismaMocks.employeeFindFirst.mockReset();
    prismaMocks.geofenceFindMany.mockReset();
  });

  it('allows clock-in at any active location assigned to the employee', async () => {
    prismaMocks.employeeFindFirst.mockResolvedValue(employeeWithAssignments);

    const result = await validateClockInLocation('employee@example.com', positionAt(LOCATION_TWO), {
      employeeId: employeeWithAssignments.id,
    });

    expect(result.passed).toBe(true);
    expect(result.geofenceName).toBe(LOCATION_TWO.name);
  });

  it('rejects clock-in at a company location that is not assigned', async () => {
    prismaMocks.employeeFindFirst.mockResolvedValue(employeeWithAssignments);

    const result = await validateClockInLocation('employee@example.com', positionAt(UNRELATED_LOCATION), {
      employeeId: employeeWithAssignments.id,
    });

    expect(result.passed).toBe(false);
    expect(result.error).toContain('Clock-in denied');
    expect([LOCATION_ONE.name, LOCATION_TWO.name]).toContain(result.geofenceName);
  });

  it('leaves an employee with no assignments unrestricted', async () => {
    prismaMocks.employeeFindFirst.mockResolvedValue({
      id: 'employee-2',
      geofenceId: null,
      companyProfileId: 'company-1',
      geofence: null,
      employeeGeofences: [],
    });

    const result = await validateClockInLocation('employee@example.com', positionAt(UNRELATED_LOCATION), {
      employeeId: 'employee-2',
    });

    expect(result).toEqual({ passed: true });
    expect(prismaMocks.geofenceFindMany).not.toHaveBeenCalled();
  });

  it('does not resolve clock-out metadata from unrelated company locations', async () => {
    prismaMocks.employeeFindFirst.mockResolvedValue({
      id: 'employee-3',
      geofenceId: null,
      companyProfileId: 'company-1',
      geofence: null,
      employeeGeofences: [{ geofence: LOCATION_ONE }],
    });

    const result = await validateClockOutLocation('employee@example.com', positionAt(UNRELATED_LOCATION), {
      employeeId: 'employee-3',
    });

    expect(result.passed).toBe(true);
    expect(result.geofenceName).toBe(LOCATION_ONE.name);
    expect(prismaMocks.geofenceFindMany).not.toHaveBeenCalled();
  });
});