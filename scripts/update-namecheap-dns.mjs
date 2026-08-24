/**
 * Namecheap DNS Automated & Guided Configuration Utility
 * -----------------------------------------------------
 * This script automates pointing the domain `time-track.tech` to the active
 * production Railway endpoints, enabling correct SSL/TLS certificate provisioning
 * and resolving the "Your connection to this site isn't secure" warning.
 *
 * It can automatically update DNS records via Namecheap API or guide you
 * step-by-step with exact instructions and live diagnostics.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');

console.log('🌐 TimeTrack DNS Setup & Diagnostics Utility\n');

// 1. Detect public IP address
async function getPublicIp() {
  const ipServices = [
    'https://api.ipify.org?format=json',
    'https://ipinfo.io/json',
    'https://ifconfig.me/all.json'
  ];

  for (const service of ipServices) {
    try {
      const res = await fetch(service, { signal: AbortSignal.timeout(5000) });
      const data = await res.json();
      const ip = data.ip || data.ip_addr || data.query;
      if (ip) return ip;
    } catch (e) {
      // Try next service
    }
  }

  // Fallback to plain text if JSON fails
  try {
    const res = await fetch('https://ifconfig.me/ip', { signal: AbortSignal.timeout(5000) });
    const ip = (await res.text()).trim();
    if (ip) return ip;
  } catch (e) {}

  return null;
}

// 2. Parse .env helper
function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) {
    console.error(`❌ .env file not found at ${ENV_PATH}`);
    process.exit(1);
  }

  const content = fs.readFileSync(ENV_PATH, 'utf-8');
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    const key = trimmed.substring(0, index).trim();
    let val = trimmed.substring(index + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) {
      val = val.substring(1, val.length - 1);
    } else if (val.startsWith("'") && val.endsWith("'")) {
      val = val.substring(1, val.length - 1);
    }
    env[key] = val;
  }
  return env;
}

async function run() {
  const publicIp = await getPublicIp();
  const env = loadEnv();

  const domain = env.NAMECHEAP_DOMAIN_REGISTERED || 'time-track.tech';
  const username = env.NAMECHEAP_USERNAME || 'ricardovsmart';
  const apiKey = env.NAMECHEAP_API_KEY;

  // The live target values retrieved from the production Railway project CLI:
  const apexTarget = env.NAMECHEAP_RECORD_APEX_CNAME || 't92g18g8.up.railway.app';
  const wwwTarget = env.NAMECHEAP_RECORD_WWW_CNAME || '5os7w7zf.up.railway.app';

  console.log(`📡 Current Public IP Address: ${publicIp || 'Undetected (Offline?)'}`);
  console.log(`📌 Domain to Configure:      ${domain}`);
  console.log(`👤 Namecheap Username:       ${username}`);
  console.log(`🔗 Target Apex CNAME/ALIAS:  ${apexTarget}`);
  console.log(`🔗 Target WWW CNAME:         ${wwwTarget}\n`);

  console.log('===============================================================');
  console.log('👉 METHOD A: MANUAL DNS CONFIGURATION (Highly Recommended)');
  console.log('===============================================================\n');
  console.log(`Log in to your Namecheap account and follow these steps:`);
  console.log(`1. Go to your Domain List -> click 'Manage' next to '${domain}'.`);
  console.log(`2. Click on the 'Advanced DNS' tab.`);
  console.log(`3. Under 'Host Records', add/edit the following records:`);
  console.log(``);
  console.log(`   ➕ Record 1:`);
  console.log(`      Type: ALIAS Record`);
  console.log(`      Host: @`);
  console.log(`      Value: ${apexTarget}`);
  console.log(`      TTL: Automatic (or 30 min / 1799)`);
  console.log(``);
  console.log(`   ➕ Record 2:`);
  console.log(`      Type: CNAME Record`);
  console.log(`      Host: www`);
  console.log(`      Value: ${wwwTarget}`);
  console.log(`      TTL: Automatic (or 30 min / 1799)`);
  console.log(``);
  console.log(`4. Remove any older ALIAS, CNAME, or A records pointing to old Railway addresses`);
  console.log(`   (such as 'fuk131ck.up.railway.app').`);
  console.log(`5. Click 'Save All Changes'. DNS changes will propagate in 5 to 30 minutes.`);
  console.log(`   Once propagated, Railway will automatically issue a valid SSL certificate.`);
  console.log(``);

  console.log('===============================================================');
  console.log('👉 METHOD B: AUTOMATED API CONFIGURATION');
  console.log('===============================================================\n');

  // Verify if a real API Key is provided
  if (!apiKey || apiKey.startsWith('http')) {
    console.log(`⚠️  API Key is currently set to a placeholder URL in .env.`);
    console.log(`To use automated DNS updates, please do the following first:`);
    console.log(`1. Go to Namecheap -> Profile -> Tools -> Business & Dev Tools.`);
    console.log(`2. Enable 'API Access' and get your API key.`);
    if (publicIp) {
      console.log(`3. Whitelist your public IP (${publicIp}) in the IP Whitelist there.`);
    } else {
      console.log(`3. Whitelist your public IP address in the IP Whitelist there.`);
    }
    console.log(`4. Update the 'NAMECHEAP_API_KEY' variable inside '.env' with your real key.`);
    console.log(`5. Re-run this script: node scripts/update-namecheap-dns.mjs`);
    return;
  }

  if (!publicIp) {
    console.error('❌ Cannot run API updates without detecting your public IP address.');
    process.exit(1);
  }

  console.log(`🚀 Attempting to update Namecheap DNS records via API...`);

  // Parse second-level domain (SLD) and top-level domain (TLD)
  const parts = domain.split('.');
  if (parts.length < 2) {
    console.error(`❌ Invalid registered domain: ${domain}`);
    process.exit(1);
  }
  const tld = parts.pop();
  const sld = parts.join('.');

  // Build Namecheap API URL for setting custom host records
  // Documentation: https://www.namecheap.com/support/api/methods/domains-dns/set-hosts/
  const params = new URLSearchParams({
    ApiUser: username,
    ApiKey: apiKey,
    UserName: username,
    Command: 'namecheap.domains.dns.setHosts',
    ClientIP: publicIp,
    SLD: sld,
    TLD: tld,

    // Host 1: Apex (@)
    HostName1: '@',
    RecordType1: 'ALIAS',
    Address1: apexTarget,
    TTL1: '1799',

    // Host 2: WWW (www)
    HostName2: 'www',
    RecordType2: 'CNAME',
    Address2: wwwTarget,
    TTL2: '1799'
  });

  const apiUrl = `https://api.namecheap.com/xml.response?${params.toString()}`;

  try {
    const res = await fetch(apiUrl);
    const xmlText = await res.text();

    console.log('\n--- Namecheap API Response ---');
    if (xmlText.includes('ErrCount="0"') || xmlText.includes('IsSuccess="true"')) {
      console.log('✅ SUCCESS! DNS records updated successfully on Namecheap.');
      console.log('   The changes are now propagating. Please wait 5-30 minutes for the SSL certificate');
      console.log('   to activate on time-track.tech.');
    } else {
      console.error('❌ API Error: Namecheap returned an error in the response.');
      // Extract errors from XML response
      const errors = [...xmlText.matchAll(/<Error[^>]*>([^<]+)<\/Error>/g)].map(m => m[1]);
      if (errors.length > 0) {
        errors.forEach(err => console.error(`   - ${err}`));
      } else {
        console.log(xmlText);
      }
      console.log('\n💡 Double check that your public IP is whitelisted in Namecheap and matches.');
    }
  } catch (err) {
    console.error(`❌ Network error calling Namecheap API: ${err.message}`);
  }
}

run();
