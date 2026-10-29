import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const manifest = readFileSync('crates/matrixgram-core/Cargo.toml', 'utf8');
assert.match(manifest, /matrix-sdk = \{[^\n]*default-features = false/);
assert.doesNotMatch(manifest, /features = \[[^\n]*"e2e-encryption"/);
const tree = execFileSync('cargo', ['tree', '-e', 'features', '-p', 'matrixgram-core', '--locked'], { encoding: 'utf8' });
for (const forbidden of ['matrix-sdk feature "e2e-encryption"', 'matrix-sdk-base feature "e2e-encryption"', 'matrix-sdk-sqlite feature "crypto-store"']) {
  assert.ok(!tree.includes(forbidden), `Forbidden Cargo feature: ${forbidden}`);
}
const config = JSON.parse(readFileSync('apps/client/src-tauri/tauri.conf.json', 'utf8'));
assert.ok(config.app.security.csp.includes("script-src 'self'"));
assert.ok(!config.app.security.csp.includes('unsafe-eval'));
console.log('PASS: no Matrix E2EE features; local content policy enabled.');
