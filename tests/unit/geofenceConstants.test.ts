import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as web from '../../src/constants/geofence';
import * as server from '../../server/src/geofenceConstants';

describe('geofence tuning parity', () => {
  const mobile = readFileSync(new URL('../../mobile/App.js', import.meta.url), 'utf8');
  it.each([
    ['CONFIRMATIONS', 'GEOFENCE_CONFIRMATIONS'],
    ['EXIT_BUFFER_METERS', 'GEOFENCE_EXIT_BUFFER_METERS'],
    ['MAX_ACCURACY_METERS', 'GEOFENCE_MAX_ACCURACY_METERS'],
    ['EVENT_COOLDOWN_MS', 'GEOFENCE_EVENT_COOLDOWN_MS'],
  ] as const)('keeps native %s aligned with web and server', (nativeName, sharedName) => {
    const literal = mobile.match(new RegExp(`const ${nativeName} = ([\\d_]+);`))?.[1];
    expect(literal).toBeDefined();
    expect(Number(literal?.replaceAll('_', ''))).toBe(web[sharedName]);
    expect(server[sharedName]).toBe(web[sharedName]);
  });
});
