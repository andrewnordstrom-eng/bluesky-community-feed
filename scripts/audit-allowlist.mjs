#!/usr/bin/env node
// Runs `npm audit` and enforces it as a gate, EXCEPT for a small set of
// explicitly time-boxed, tracked advisory exceptions.
//
// Each exception MUST carry a hard `expires` date and a `tracking` issue.
// After the expiry date the advisory is enforced again automatically — the
// gate self-heals and re-blocks, forcing remediation. This keeps the loosening
// visible, bounded, and reversible rather than a silent permanent bypass.
//
// Usage: node scripts/audit-allowlist.mjs [--audit-level=high|moderate|critical|low]
// Exit 0 if the only vulns at/above the level are non-expired allowlisted ones;
// exit 1 otherwise (including if an allowlist entry has expired).

import { spawnSync } from 'node:child_process';

// --- Time-boxed, tracked exceptions ------------------------------------------
// Do NOT add an entry without both `expires` and `tracking`.
const ALLOWLIST = [
  {
    id: 'GHSA-gv7w-rqvm-qjhr',
    package: 'esbuild',
    reason:
      'esbuild dev-tooling RCE via NPM_CONFIG_REGISTRY. Dev dependency only ' +
      '(tsx/vite/vitest); not reachable from the deployed runtime. Patched in ' +
      'esbuild 0.28.1, which was newer than the repo .npmrc min-release-age=3 ' +
      'cooldown when this exception was added.',
    expires: '2026-06-18',
    tracking: 'PROJ-1283',
  },
  {
    id: 'GHSA-g7r4-m6w7-qqqr',
    package: 'esbuild',
    reason:
      'esbuild dev-server arbitrary file read (Windows). Dev dependency only; ' +
      'not reachable from the deployed runtime. Patched in esbuild 0.28.1.',
    expires: '2026-06-18',
    tracking: 'PROJ-1283',
  },
];
// -----------------------------------------------------------------------------

const SEVERITY_RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

function parseLevel(argv) {
  let level = 'high';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--audit-level' && argv[i + 1]) level = argv[++i];
    else if (argv[i].startsWith('--audit-level=')) level = argv[i].slice('--audit-level='.length);
  }
  return level;
}

function partitionAllowlist(now) {
  const active = new Map();
  const expired = [];
  for (const e of ALLOWLIST) {
    if (now <= new Date(`${e.expires}T23:59:59Z`)) active.set(e.id, e);
    else expired.push(e);
  }
  return { active, expired };
}

function advisoryIdsFromVia(via) {
  const out = [];
  for (const v of via || []) {
    if (v && typeof v === 'object') {
      const m = String(v.url || '').match(/(GHSA-[0-9a-z-]+|CVE-\d{4}-\d+)/i);
      if (m) out.push({ id: m[1], severity: v.severity, url: String(v.url || '') });
    }
  }
  return out;
}

function main() {
  const level = parseLevel(process.argv.slice(2));
  const threshold = SEVERITY_RANK[level] ?? SEVERITY_RANK.high;
  const now = new Date();

  const res = spawnSync('npm', ['audit', '--json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) {
    console.error(`audit-allowlist: failed to run npm audit: ${res.error.message}`);
    process.exit(1);
  }
  let report;
  try {
    report = JSON.parse(res.stdout);
  } catch {
    console.error('audit-allowlist: could not parse `npm audit --json` output');
    console.error((res.stdout || '').slice(0, 2000));
    // Surface stderr too: registry connectivity / auth failures land here.
    if (res.stderr) console.error((res.stderr).slice(0, 2000));
    process.exit(1);
  }

  // Collect distinct advisories at/above the threshold across all packages.
  const present = new Map(); // id -> { severity, url, packages:Set }
  for (const [pkg, info] of Object.entries(report.vulnerabilities || {})) {
    if ((SEVERITY_RANK[info.severity] ?? 0) < threshold) continue;
    for (const adv of advisoryIdsFromVia(info.via)) {
      const sev = SEVERITY_RANK[adv.severity] ?? SEVERITY_RANK[info.severity] ?? 0;
      if (sev < threshold) continue;
      const cur = present.get(adv.id) || { severity: adv.severity, url: adv.url, packages: new Set() };
      cur.packages.add(pkg);
      present.set(adv.id, cur);
    }
  }

  // Fail closed: npm reports vulns at/above threshold but we extracted no IDs.
  const meta = report.metadata?.vulnerabilities || {};
  const countAtOrAbove = Object.entries(meta)
    .filter(([sev]) => (SEVERITY_RANK[sev] ?? -1) >= threshold)
    .reduce((n, [, c]) => n + (c || 0), 0);
  if (countAtOrAbove > 0 && present.size === 0) {
    console.error(
      `audit-allowlist: npm reports ${countAtOrAbove} vuln(s) >= ${level} but no advisory IDs ` +
        'could be extracted; failing closed.',
    );
    process.exit(1);
  }

  const { active, expired } = partitionAllowlist(now);
  const honored = [];
  const blocking = [];
  for (const [id, v] of present) {
    if (active.has(id)) honored.push({ id, ...v, entry: active.get(id) });
    else blocking.push({ id, ...v });
  }

  if (honored.length) {
    console.log(`audit-allowlist: honoring ${honored.length} time-boxed exception(s) at level=${level}:`);
    for (const h of honored) {
      console.log(
        `  - ${h.id} [${h.severity}] (${[...h.packages].join(', ')}) -> allowed until ${h.entry.expires} (${h.entry.tracking})`,
      );
    }
  }
  if (expired.length) {
    console.log('audit-allowlist: the following exceptions have EXPIRED and are now enforced:');
    for (const e of expired) console.log(`  - ${e.id} expired ${e.expires} (${e.tracking}) -> remediate now`);
  }

  if (blocking.length) {
    console.error(`audit-allowlist: ${blocking.length} non-allowlisted vuln(s) >= ${level}:`);
    for (const b of blocking) console.error(`  - ${b.id} [${b.severity}] (${[...b.packages].join(', ')}) ${b.url}`);
    console.error('audit-allowlist: FAIL');
    process.exit(1);
  }

  console.log(`audit-allowlist: PASS (no non-allowlisted vulns >= ${level}).`);
  process.exit(0);
}

main();
