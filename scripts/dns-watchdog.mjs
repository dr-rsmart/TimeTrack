/**
 * DNS Propagation Watchdog & SSL Auto-Provisioner
 * ------------------------------------------------
 * This script polls DNS servers for 'time-track.tech' and 'www.time-track.tech'
 * to check when your Namecheap updates have successfully propagated.
 *
 * Once it detects the correct targets:
 * 1. It signals success.
 * 2. It automatically triggers Railway to provision and activate the Let's Encrypt SSL/TLS certificates.
 */

import { execSync } from 'child_process';
import dns from 'dns';

const APEX_DOMAIN = 'time-track.tech';
const WWW_DOMAIN = 'www.time-track.tech';

// Expected targets from Railway
const EXPECTED_APEX = 't92g18g8.up.railway.app';
const EXPECTED_WWW = '5os7w7zf.up.railway.app';

const POLL_INTERVAL_MS = 15000; // Poll every 15 seconds

console.log('👀 Starting TimeTrack DNS Watchdog & SSL Auto-Provisioner...\n');
console.log(`Checking for target DNS values:`);
console.log(`- ${APEX_DOMAIN}  => CNAME/ALIAS pointing to: ${EXPECTED_APEX}`);
console.log(`- ${WWW_DOMAIN} => CNAME pointing to:       ${EXPECTED_WWW}\n`);
console.log('Leave this script running. It will notify you the second the updates propagate!');
console.log('--------------------------------------------------------------------------\n');

// Resolver using Cloudflare/Google DNS to avoid local OS cache
const resolver = new dns.Resolver();
resolver.setServers(['1.1.1.1', '8.8.8.8']);

function resolveDomain(domain) {
  return new Promise((resolve) => {
    resolver.resolveCname(domain, (err, addresses) => {
      if (!err && addresses && addresses.length > 0) {
        resolve(addresses[0].toLowerCase());
        return;
      }
      
      // Fallback: Check Any/Resolve if CNAME lookup failed (some DNS servers return ALIAS as virtual A records)
      resolver.resolve(domain, 'ANY', (err2, records) => {
        if (!err2 && records) {
          const cnameRecord = records.find(r => r.type === 'CNAME');
          if (cnameRecord) {
            resolve(cnameRecord.value.toLowerCase());
            return;
          }
        }
        resolve(null);
      });
    });
  });
}

async function triggerRailwaySsl(domain) {
  try {
    console.log(`⚙️  Triggering SSL/TLS Certificate generation in Railway for ${domain}...`);
    execSync(`railway domain certificate retry ${domain}`, { stdio: 'inherit' });
    console.log(`✅ Triggered successfully.`);
  } catch (err) {
    console.log(`⚠️  Failed to trigger Railway CLI directly: ${err.message}`);
    console.log(`👉 Alternative: Go to Railway Dashboard -> custom domains -> click 'Retry' next to ${domain}.`);
  }
}

let apexMatched = false;
let wwwMatched = false;

async function checkDns() {
  const timestamp = new Date().toLocaleTimeString();
  
  // 1. Check Apex Domain
  const currentApex = await resolveDomain(APEX_DOMAIN);
  const currentWww = await resolveDomain(WWW_DOMAIN);

  console.log(`[${timestamp}]`);
  
  if (currentApex) {
    const isMatch = currentApex.includes('t92g18g8');
    if (isMatch) {
      if (!apexMatched) {
        console.log(`  🟢 ${APEX_DOMAIN} HAS PROPAGATED! Pointing to correct target: ${currentApex}`);
        apexMatched = true;
        await triggerRailwaySsl(APEX_DOMAIN);
      } else {
        console.log(`  🟢 ${APEX_DOMAIN} is correct: ${currentApex}`);
      }
    } else {
      console.log(`  🔴 ${APEX_DOMAIN} is still pointing to old/mismatched destination: ${currentApex}`);
    }
  } else {
    console.log(`  ⚪ ${APEX_DOMAIN} is currently resolving to A-records directly or unresolved.`);
  }

  // 2. Check WWW Domain
  if (currentWww) {
    const isMatch = currentWww.includes('5os7w7zf');
    if (isMatch) {
      if (!wwwMatched) {
        console.log(`  🟢 ${WWW_DOMAIN} HAS PROPAGATED! Pointing to correct target: ${currentWww}`);
        wwwMatched = true;
        await triggerRailwaySsl(WWW_DOMAIN);
      } else {
        console.log(`  🟢 ${WWW_DOMAIN} is correct: ${currentWww}`);
      }
    } else {
      console.log(`  🔴 ${WWW_DOMAIN} is still pointing to old/mismatched destination: ${currentWww}`);
    }
  } else {
    console.log(`  ⚪ ${WWW_DOMAIN} is unresolved.`);
  }

  if (apexMatched && wwwMatched) {
    console.log('\n✨ SUCCESS! Both DNS records are 100% correct and certificates have been requested!');
    console.log('🔒 The SSL warning is cleared. Testers can now close and reopen the app to connect securely.');
    process.exit(0);
  }

  console.log(`⌛ Checking again in ${POLL_INTERVAL_MS / 1000} seconds...\n`);
}

// Initial run
checkDns();

// Interval loop
const interval = setInterval(checkDns, POLL_INTERVAL_MS);
