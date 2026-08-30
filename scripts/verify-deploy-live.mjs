/**
 * Live production deployment verification (read-only, credential-free).
 * ---------------------------------------------------------------------
 * Confirms that the newest commit (multi-location geofencing, weekly shift
 * schedules) is live on https://time-track.tech by checking:
 *   1. /api/health uptime (detects the deployment swap),
 *   2. the served frontend bundle contains markers from the NEW code
 *      (`geofenceIds`, `weeklySchedule`),
 *   3. OPTIONAL: if VERIFY_EMAIL/VERIFY_PASSWORD are provided, logs in and
 *      checks the NEW `geofenceIds` field on GET /api/settings/geofences/my.
 *
 * Usage: node scripts/verify-deploy-live.mjs
 */

const BASE = 'https://time-track.tech';
const EMAIL = process.env.VERIFY_EMAIL || '';
const PASSWORD = process.env.VERIFY_PASSWORD || '';

async function getHealth() {
  const res = await fetch(`${BASE}/api/health`);
  if (!res.ok) throw new Error(`health ${res.status}`);
  return res.json();
}

async function checkBundleMarkers() {
  const indexRes = await fetch(`${BASE}/`, { headers: { 'Cache-Control': 'no-cache' } });
  if (!indexRes.ok) throw new Error(`index ${indexRes.status}`);
  const html = await indexRes.text();
  const assetMatch = html.match(/assets\/(index-[^"']+\.js)/);
  if (!assetMatch) throw new Error('could not locate main JS asset in index.html');
  const jsUrl = `${BASE}/assets/${assetMatch[1]}`;
  const jsRes = await fetch(jsUrl);
  if (!jsRes.ok) throw new Error(`asset ${jsRes.status}`);
  const js = await jsRes.text();
  return {
    asset: assetMatch[1],
    geofenceIds: js.includes('geofenceIds'),
    weeklySchedule: js.includes('weeklySchedule'),
  };
}

async function checkAuthedEndpoints() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`login failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const authHeaders = { Authorization: `Bearer ${data.token}` };

  const myRes = await fetch(`${BASE}/api/settings/geofences/my`, { headers: authHeaders });
  if (!myRes.ok) throw new Error(`geofences/my failed (${myRes.status})`);
  const my = await myRes.json();
  const hasGeofenceIds = my.employee && Object.prototype.hasOwnProperty.call(my.employee, 'geofenceIds');
  console.log(`[verify-live] /settings/geofences/my → geofenceIds field: ${hasGeofenceIds ? `YES ${JSON.stringify(my.employee.geofenceIds)}` : 'NO (old code)'}`);
  return hasGeofenceIds;
}

async function main() {
  const health = await getHealth();
  console.log(`[verify-live] health ok — uptime ${health.uptime}s, db ${health.database?.status}, latency ${health.database?.latencyMs}ms`);

  const markers = await checkBundleMarkers();
  console.log(`[verify-live] bundle ${markers.asset} → geofenceIds: ${markers.geofenceIds ? 'YES' : 'NO'}, weeklySchedule: ${markers.weeklySchedule ? 'YES' : 'NO'}`);

  if (EMAIL && PASSWORD) {
    try {
      const ok = await checkAuthedEndpoints();
      if (ok && markers.geofenceIds) {
        console.log('[verify-live] ✅ NEW CODE IS LIVE (bundle + API verified)');
        process.exit(0);
      }
    } catch (err) {
      console.log(`[verify-live] authed check skipped/failed: ${err.message}`);
    }
  }

  if (markers.geofenceIds && markers.weeklySchedule) {
    console.log('[verify-live] ✅ NEW CODE IS LIVE (bundle markers verified)');
    process.exit(0);
  } else {
    console.log('[verify-live] ⏳ Old code still serving — deployment has not swapped over yet.');
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(`[verify-live] ❌ ${err.message}`);
  process.exit(1);
});

