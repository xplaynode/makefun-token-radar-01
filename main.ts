// Launch Radar (token-radar-01): a Node 22 program, standard library only.
//
// It reads the sealed snapshot (--input <file|dir>, default /input/snapshot.json), scores every
// launch candidate with the model in lib/model.ts and the farm plans in lib/farm.ts, writes the
// ranked board to /output/board.json, writes the dashboard's data to /output/data.js, copies
// dashboard/ and screenshots/ into /output, and writes /output/dossier.json with buildDossier
// from vendor/makefun-board.ts — byte for byte what the scorer rebuilds and compares.
//
// Run locally:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
// MAKEFUN_DATA_ONLY=1 stops after board.json, data.js and the dashboard copy: the pass used to
// render the screenshots the full run then ships.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSnapshot } from './lib/model.ts';
import { boardIssue, buildRadar, dataScript } from './lib/board.ts';
import { buildDossier, PLAIN_NAME } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The dossier text cap the scorer rebuilds with; the other caps only refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };

/** --name <value> or --name=<value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`launch radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
const dataOnly = process.env.MAKEFUN_DATA_ONLY === '1';

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`launch radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy a directory tree's regular files into `to`, skipping names that start with a dot. */
function copyTree(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    const dest = join(to, name);
    if (statSync(path).isDirectory()) {
      copied.push(...copyTree(path, dest).map((n) => join(name, n)));
    } else if (statSync(path).isFile()) {
      copyFileSync(path, dest);
      copied.push(name);
    }
  }
  return copied;
}

const dashFiles = copyTree(join(here, 'dashboard'), join(out, 'dashboard'));

if (dataOnly) {
  process.stdout.write(
    `launch radar: data-only pass: ${board.length} rows scored, wrote ${join(out, 'board.json')}, ${join(out, 'data.js')} and dashboard/ (${dashFiles.length} files)\n`,
  );
  process.exit(0);
}

const shots = copyTree(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3 || shots.length > 4) {
  process.stderr.write(`launch radar: screenshots/ holds ${shots.length} images: hand in 3 or 4 (the board, a detail view, a filtered view)\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!PLAIN_NAME.test(name)) {
    process.stderr.write(`launch radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters, not starting with . or -\n`);
    process.exit(1);
  }
  const bytes = statSync(join(out, 'screenshots', name)).size;
  if (bytes > SCREENSHOT_CAPS.max_bytes) {
    process.stderr.write(`launch radar: screenshots/${name} is ${bytes} bytes, past the ${SCREENSHOT_CAPS.max_bytes} cap\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
const dossier = buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS });
writeFileSync(join(out, 'dossier.json'), dossier);

process.stdout.write(
  `launch radar: ${snapshot.protocols.length} protocols scanned, ${snapshot.watchlist.length} on the watchlist, ${board.length} launch candidates ranked, ${radar.products.length} products set aside, ${radar.live.length} live tokens shown apart\n` +
    `launch radar: wrote board.json (${board.length} rows), data.js, dashboard/ (${dashFiles.length} files), screenshots/ (${shots.length} images) and dossier.json (${dossier.length} bytes) under ${relative(process.cwd(), out) || out}\n`,
);
