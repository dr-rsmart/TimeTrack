import { describe, expect, it } from 'vitest';
import { workLocationSummary } from '../../src/utils/workLocationSummary';

const locations = [
  { id: 'office', isActive: true },
  { id: 'depot', isActive: true },
  { id: 'closed', isActive: false },
];

describe('work location subtitle', () => {
  it.each([
    [['office'], '1 assigned location · 2 active company locations'],
    [['office', 'depot'], '2 assigned locations · 2 active company locations'],
    [[], '2 active company locations · No assigned location'],
    [['closed'], '0 active assigned locations · 2 active company locations'],
    [['missing'], '0 active assigned locations · 2 active company locations'],
    [['office', 'office'], '1 assigned location · 2 active company locations'],
  ])('counts %j without claiming unrelated sites are monitored', (assigned, expected) => {
    expect(workLocationSummary(locations, assigned as string[])).toBe(expected);
  });
  it('handles singular and empty company counts', () => {
    expect(workLocationSummary(locations.slice(0, 1), ['office'])).toBe(
      '1 assigned location · 1 active company location',
    );
    expect(workLocationSummary([], [])).toBe('0 active company locations · No assigned location');
  });
});
