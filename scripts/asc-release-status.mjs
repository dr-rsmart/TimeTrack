// Temp rollout probe: full ASC status for the TimeTrack iOS release.
import fs from 'node:fs';
import crypto from 'node:crypto';

const key = JSON.parse(fs.readFileSync('asc-api-key.json', 'utf8'));
const b64 = (i) =>
  Buffer.from(i).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const now = Math.floor(Date.now() / 1000);
const p =
  b64(JSON.stringify({ alg: 'ES256', kid: key.key_id, typ: 'JWT' })) +
  '.' +
  b64(JSON.stringify({ iss: key.issuer_id, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' }));
const sig = crypto
  .createSign('SHA256')
  .update(p)
  .sign({ key: key.key_p8, dsaEncoding: 'ieee-p1363' });
const token = p + '.' + b64(sig);
const H = { Authorization: 'Bearer ' + token, Accept: 'application/json' };
const api = async (path) => {
  const url =
    'https://api.appstoreconnect.apple.com/v1' + path.replace(/\[/g, '%5B').replace(/\]/g, '%5D');
  const r = await fetch(url, { headers: H });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${path}: ${t.slice(0, 600)}`);
  return JSON.parse(t);
};

const versions = await api('/apps/6803827296/appStoreVersions?limit=5');
const out = { versions: [] };
for (const v of versions.data || []) {
  let buildVersion = null;
  try {
    const rel = await api(`/appStoreVersions/${v.id}/relationships/build`);
    if (rel.data && rel.data.id) {
      const b = await api(`/builds/${rel.data.id}`);
      buildVersion = {
        version: b.data.attributes.version,
        processingState: b.data.attributes.processingState,
        expired: b.data.attributes.expired,
      };
    }
  } catch (e) {
    buildVersion = { error: e.message };
  }
  out.versions.push({
    version: v.attributes.version,
    platform: v.attributes.platform,
    appStoreState: v.attributes.appStoreState,
    releaseType: v.attributes.releaseType,
    build: buildVersion,
  });
}

const submissions = await api('/reviewSubmissions?filter[app]=6803827296&limit=3');
out.reviewSubmissions = (submissions.data || []).map((s) => ({
  id: s.id,
  state: s.attributes.state,
  platform: s.attributes.platform,
}));

const builds21 = await api('/builds?filter[app]=6803827296&filter[version]=21&limit=2');
out.builds21 = (builds21.data || []).map((b) => ({
  version: b.attributes.version,
  processingState: b.attributes.processingState,
  expired: b.attributes.expired,
  uploadedDate: b.attributes.uploadedDate,
}));

console.log(JSON.stringify(out, null, 2));
