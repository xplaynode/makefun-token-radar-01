// Launch Radar self-test: checks an output directory against every gate row that can be
// checked locally, and (with --input) verifies the program is deterministic by running the
// data pass twice and comparing board.json byte for byte.
//
//   node tools/selftest.mjs <outdir> [--input <snapshot.json>]
//
// Exits 0 when every check passes, 1 otherwise. It never touches the network.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = process.argv[2];
if (!out) {
  process.stderr.write('usage: node tools/selftest.mjs <outdir> [--input <snapshot.json>]\n');
  process.exit(2);
}
const inputAt = process.argv.indexOf('--input');
const input = inputAt >= 0 ? process.argv[inputAt + 1] : null;

let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures++;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}\n`);
}

const boardPath = join(out, 'board.json');
check('board.json exists', existsSync(boardPath));
const board = JSON.parse(readFileSync(boardPath, 'utf8'));
const rows = board.rows;
const snapshot = input ? JSON.parse(readFileSync(input, 'utf8')) : null;

check('row count within 100..4000', rows.length >= 100 && rows.length <= 4000, `${rows.length} rows`);
check('board.json at most 8 MiB', statSync(boardPath).size <= 8 * 1024 * 1024, `${statSync(boardPath).size} bytes`);

const slugs = new Set(rows.map((r) => r.slug));
check('slugs unique', slugs.size === rows.length);
if (snapshot) {
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  check('every slug is a snapshot protocol', rows.every((r) => known.has(r.slug)));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  check('watchlist fully covered', missing.length === 0, missing.length ? `missing ${missing.slice(0, 3).join(', ')}` : `${snapshot.watchlist.length}/${snapshot.watchlist.length}`);
}
let ranksOk = true;
let sortedOk = true;
let valuesOk = true;
let stepsOk = true;
for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  if (r.rank !== i + 1) ranksOk = false;
  if (i > 0 && r.implied_value_usd > rows[i - 1].implied_value_usd) sortedOk = false;
  if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) valuesOk = false;
  if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) stepsOk = false;
  else for (const s of r.farm_steps) {
    const t = s.trim();
    if (t.length < 20 || t.length > 600) stepsOk = false;
  }
}
check('ranks are exactly 1..N', ranksOk);
check('implied value never rises as rank ascends', sortedOk);
check('implied values are positive whole dollars within the cap', valuesOk);
check('not all implied values equal', rows.length < 2 || rows[0].implied_value_usd !== rows[rows.length - 1].implied_value_usd);
check('every farm_steps holds 3..12 strings of 20..600 trimmed chars', stepsOk);

/* dashboard files */
const dashDir = join(out, 'dashboard');
const dashFiles = existsSync(dashDir) ? readdirSync(dashDir) : [];
check('dashboard holds index.html, a .css and a .js', dashFiles.includes('index.html') && dashFiles.some((f) => f.endsWith('.css')) && dashFiles.some((f) => f.endsWith('.js')), dashFiles.join(', '));
let dashBytes = 0;
let networkOk = true;
for (const f of dashFiles) {
  const p = join(dashDir, f);
  dashBytes += statSync(p).size;
  const text = readFileSync(p, 'utf8');
  if (/(?:href|src)\s*=\s*"https?:\/\//i.test(text) || /@import\s+["']https?:/i.test(text) || /url\(\s*["']?https?:/i.test(text)) networkOk = false;
}
check('dashboard within 400 files and 4 MiB', dashFiles.length <= 400 && dashBytes <= 4 * 1024 * 1024, `${dashFiles.length} files, ${dashBytes} bytes`);
check('dashboard source under the 64 KB dossier text cap', dashBytes <= 65536, `${dashBytes} bytes`);
check('no network address in any dashboard attribute, import or CSS url', networkOk);

/* screenshots + dossier (full runs only) */
const shotDir = join(out, 'screenshots');
if (existsSync(shotDir)) {
  const shots = readdirSync(shotDir).filter((f) => !f.startsWith('.'));
  check('3 or 4 screenshots', shots.length >= 3 && shots.length <= 4, `${shots.length} images`);
  for (const name of shots) {
    const buf = readFileSync(join(shotDir, name));
    const isPng = buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50;
    const isJpeg = buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8;
    let dims = 'unknown format';
    let dimsOk = false;
    if (isPng) {
      const w = buf.readUInt32BE(16);
      const h = buf.readUInt32BE(20);
      dims = `${w}x${h}`;
      dimsOk = Math.max(w, h) <= 1440 && Math.min(w, h) >= 800;
    }
    check(`screenshot ${name}: whole PNG/JPEG, at most 512 KiB`, (isPng || isJpeg) && buf.length <= 512 * 1024, `${buf.length} bytes, ${dims}`);
    if (isPng) check(`screenshot ${name}: long side at most 1440, short side at least 800`, dimsOk, dims);
  }
  const dossierPath = join(out, 'dossier.json');
  check('dossier.json exists and is at most 1.5 MiB', existsSync(dossierPath) && statSync(dossierPath).size <= 1.5 * 1024 * 1024, existsSync(dossierPath) ? `${statSync(dossierPath).size} bytes` : 'missing');
}

/* determinism: two data-only passes must write identical board.json bytes */
if (input) {
  const here = new URL('..', import.meta.url).pathname;
  const a = mkdtempSync(join(tmpdir(), 'radar-a-'));
  const b = mkdtempSync(join(tmpdir(), 'radar-b-'));
  const env = { ...process.env, MAKEFUN_DATA_ONLY: '1' };
  execFileSync('node', [join(here, 'main.ts'), '--input', input, '--output', a], { env, stdio: 'pipe' });
  execFileSync('node', [join(here, 'main.ts'), '--input', input, '--output', b], { env, stdio: 'pipe' });
  const same = readFileSync(join(a, 'board.json')).equals(readFileSync(join(b, 'board.json'))) &&
    readFileSync(join(a, 'data.js')).equals(readFileSync(join(b, 'data.js')));
  check('deterministic: two runs write identical board.json and data.js', same);
}

process.stdout.write(failures === 0 ? 'SELFTEST: all checks passed\n' : `SELFTEST: ${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
