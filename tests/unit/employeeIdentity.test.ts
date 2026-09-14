import { describe, expect, it } from 'vitest';
import {
  employeeIdentityFilter,
  identityKey,
  normalizeEmployeeEmail,
} from '../../server/src/domain/employeeIdentity.js';

describe('employee identity bridge', () => {
  const employees = [
    { id: 'emp-1', email: ' A@Example.com ' },
    { id: 'emp-2', email: 'b@example.com' },
  ];

  it('normalizes employee emails consistently', () => {
    expect(normalizeEmployeeEmail('  Person@Example.COM ')).toBe('person@example.com');
  });

  it('prefers IDs while retaining only unlinked legacy email rows', () => {
    expect(employeeIdentityFilter(employees)).toEqual({
      OR: [
        { employeeId: { in: ['emp-1', 'emp-2'] } },
        { employeeId: null, employeeEmail: { in: ['a@example.com', 'b@example.com'] } },
      ],
    });
  });

  it('uses an explicit legacy key only when no ID exists', () => {
    expect(identityKey('emp-1', 'a@example.com')).toBe('emp-1');
    expect(identityKey(null, ' A@Example.com ')).toBe('legacy:a@example.com');
  });
});
