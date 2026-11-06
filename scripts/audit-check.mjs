// Dependency gate for CI: fails on any high/critical advisory in production dependencies that is not
// explicitly accepted in security/audit-allowlist.json, and on accepted advisories past their review date.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const allow = JSON.parse(readFileSync(new URL('../security/audit-allowlist.json', import.meta.url), 'utf8'));
let raw;
try {
  raw = execSync('npm audit --omit=dev --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
} catch (err) {
  raw = err.stdout; // npm audit exits non-zero when it finds anything
}
const report = JSON.parse(raw);
const today = new Date().toISOString().slice(0, 10);
const problems = [];
const accepted = new Set();

for (const vuln of Object.values(report.vulnerabilities ?? {})) {
  for (const via of vuln.via) {
    if (typeof via !== 'object' || !['high', 'critical'].includes(via.severity)) continue;
    const id = via.url?.split('/').pop();
    const entry = allow[id];
    if (!entry) problems.push(`${id} ${via.severity} in ${vuln.name}: ${via.title}`);
    else if (entry.reviewBy < today) problems.push(`${id} acceptance expired on ${entry.reviewBy} (${entry.package})`);
    else accepted.add(id);
  }
}

for (const id of accepted) console.log(`accepted: ${id} (${allow[id].package}) until ${allow[id].reviewBy}`);
if (problems.length) {
  console.error(`\nUnaccepted high/critical advisories:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`dependency audit ok (${report.metadata?.vulnerabilities?.total ?? 0} total findings, all high/critical reviewed)`);
