// Pre-Token Radar — entry program for make.fun token-radar-01.
//
// Reads the sealed snapshot at /input/snapshot.json (or --input), builds the
// Compass board with lib/model.ts, and writes the whole output tree:
//   board.json, data.js, dashboard/, screenshots/, dossier.json
//
// Output directory: --output wins, then $MAKEFUN_OUTPUT_DIR, then "out".
// The run is deterministic: same snapshot in, byte-identical files out.
// Node 22+, standard library only.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, cpSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBoard } from "./lib/model.ts";
import type { SnapshotDoc, SnapshotProtocol } from "./lib/model.ts";
import { buildDossier } from "./vendor/makefun-board.ts";

const REPO_ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_INPUT = "/input/snapshot.json";
const DOSSIER_TEXT_MAX_BYTES = 65536;
const SCREENSHOT_MAX_BYTES = 524288;
const SCREENSHOT_MAX_COUNT = 4;
const SCREENSHOT_MIN_COUNT = 3;
const DASHBOARD_MAX_FILES = 400;
const DASHBOARD_MAX_BYTES = 4194304;
const DOSSIER_MAX_BYTES = 1536000;

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): { input: string; output: string } {
  let input = DEFAULT_INPUT;
  let output = process.env.MAKEFUN_OUTPUT_DIR ?? "out";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input" && i + 1 < argv.length) input = argv[++i];
    else if (argv[i].startsWith("--input=")) input = argv[i].slice("--input=".length);
    else if (argv[i] === "--output" && i + 1 < argv.length) output = argv[++i];
    else if (argv[i].startsWith("--output=")) output = argv[i].slice("--output=".length);
    else fail(`unknown argument: ${argv[i]}`);
  }
  return { input, output };
}

/** A listed_at value must be null or a real calendar date (YYYY-MM-DD). */
function isRealCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/**
 * Strict snapshot validation, applied before any modelling:
 * - the document shape (as_of / floor_usd / protocols / watchlist) must hold;
 * - every protocol needs a slug, a name and a chains array;
 * - a negative TVL is rejected outright;
 * - a negative market cap is normalised to null (no token value recorded);
 * - a listed_at that is not null and not a real calendar date is rejected.
 */
function validateSnapshot(doc: unknown): SnapshotDoc {
  if (typeof doc !== "object" || doc === null) fail("snapshot is not an object");
  const d = doc as Record<string, unknown>;
  if (typeof d.as_of !== "string" || !isRealCalendarDate(d.as_of)) fail("snapshot as_of is not a calendar date");
  if (typeof d.floor_usd !== "number" || !Number.isFinite(d.floor_usd) || d.floor_usd <= 0) {
    fail("snapshot floor_usd is not a positive number");
  }
  if (!Array.isArray(d.protocols)) fail("snapshot protocols is not an array");
  if (!Array.isArray(d.watchlist) || d.watchlist.some((s) => typeof s !== "string")) {
    fail("snapshot watchlist is not an array of strings");
  }
  const seen = new Set<string>();
  for (const raw of d.protocols as unknown[]) {
    if (typeof raw !== "object" || raw === null) fail("snapshot protocol is not an object");
    const p = raw as Record<string, unknown>;
    if (typeof p.slug !== "string" || p.slug.length === 0) fail("snapshot protocol without a slug");
    if (seen.has(p.slug)) fail(`duplicate protocol slug in snapshot: ${p.slug}`);
    seen.add(p.slug);
    if (typeof p.name !== "string" || p.name.length === 0) fail(`protocol ${p.slug} without a name`);
    if (!Array.isArray(p.chains) || p.chains.some((c) => typeof c !== "string")) {
      fail(`protocol ${p.slug} without a chains array`);
    }
    if (typeof p.tvl_usd !== "number" || !Number.isFinite(p.tvl_usd)) fail(`protocol ${p.slug} without a finite tvl_usd`);
    if (p.tvl_usd < 0) fail(`protocol ${p.slug} has a negative tvl_usd`);
    if (p.mcap_usd !== null && (typeof p.mcap_usd !== "number" || !Number.isFinite(p.mcap_usd))) {
      fail(`protocol ${p.slug} without a finite mcap_usd`);
    }
    if (p.change_7d !== null && (typeof p.change_7d !== "number" || !Number.isFinite(p.change_7d))) {
      fail(`protocol ${p.slug} without a finite change_7d`);
    }
    if (p.listed_at !== null && (typeof p.listed_at !== "string" || !isRealCalendarDate(p.listed_at))) {
      fail(`protocol ${p.slug} has a listed_at that is not a calendar date`);
    }
  }
  // Normalise: a negative market cap means "no usable token value recorded".
  const protocols = (d.protocols as SnapshotProtocol[]).map((p) => ({
    ...p,
    mcap_usd: p.mcap_usd !== null && p.mcap_usd < 0 ? null : p.mcap_usd,
  }));
  return {
    as_of: d.as_of as string,
    source: typeof d.source === "string" ? d.source : "",
    floor_usd: d.floor_usd as number,
    protocols,
    watchlist: d.watchlist as string[],
  };
}

function countFiles(dir: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = countFiles(path);
      files += sub.files;
      bytes += sub.bytes;
    } else if (entry.isFile()) {
      files += 1;
      bytes += statSync(path).size;
    }
  }
  return { files, bytes };
}

function isPng(bytes: Buffer): boolean {
  return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

function isJpeg(bytes: Buffer): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/** Gate the screenshots before the dossier is built: 3-4 real PNG/JPEG
 *  files, each within the byte cap, checked by magic bytes, not extension. */
function validateScreenshots(dir: string): string[] {
  if (!existsSync(dir)) fail(`screenshots directory missing: ${dir}`);
  const names = readdirSync(dir)
    .filter((n) => !n.startsWith("."))
    .sort();
  if (names.length < SCREENSHOT_MIN_COUNT || names.length > SCREENSHOT_MAX_COUNT) {
    fail(`expected ${SCREENSHOT_MIN_COUNT}-${SCREENSHOT_MAX_COUNT} screenshots, found ${names.length}`);
  }
  for (const name of names) {
    const path = join(dir, name);
    if (!statSync(path).isFile()) fail(`screenshot is not a regular file: ${name}`);
    const bytes = readFileSync(path);
    if (bytes.length > SCREENSHOT_MAX_BYTES) {
      fail(`screenshot over the ${SCREENSHOT_MAX_BYTES} byte cap: ${name} (${bytes.length} bytes)`);
    }
    if (!isPng(bytes) && !isJpeg(bytes)) {
      fail(`screenshot is not a real PNG or JPEG (magic bytes): ${name}`);
    }
  }
  return names;
}

function main(): void {
  const { input, output } = parseArgs(process.argv.slice(2));
  const snapshot = validateSnapshot(JSON.parse(readFileSync(input, "utf8")));
  const board = buildBoard(snapshot);

  // Board-shape guard: the radar must rank the whole watchlist plus the 180
  // early finds, and set aside the 24 largest trading tokens. If a snapshot
  // ever changed shape, fail loudly instead of handing in a short board.
  if (board.rows.length !== 220) fail(`expected 220 board rows, got ${board.rows.length}`);
  if (board.meta.watchlist_rows !== snapshot.watchlist.length) {
    fail(`watchlist coverage ${board.meta.watchlist_rows}/${snapshot.watchlist.length}`);
  }
  if (board.meta.early_rows !== 180) fail(`expected 180 early rows, got ${board.meta.early_rows}`);
  if (board.trading.length !== 24) fail(`expected 24 trading rows, got ${board.trading.length}`);

  mkdirSync(output, { recursive: true });
  mkdirSync(join(output, "dashboard"), { recursive: true });
  mkdirSync(join(output, "screenshots"), { recursive: true });

  // Board: the ranked rows plus the model metadata the page shows.
  const boardJson = { meta: board.meta, rows: board.rows };
  writeFileSync(join(output, "board.json"), JSON.stringify(boardJson, null, 2) + "\n", "utf8");

  // Data the dashboard reads: rows without farm steps (the drawer derives
  // them from the same fields), the trading set, and every category multiple.
  const data = {
    meta: board.meta,
    globalMultiple: board.globalMultiple,
    multiples: board.multiples,
    rows: board.rows.map(({ farm_steps: _steps, ...row }) => row),
    trading: board.trading,
  };
  writeFileSync(join(output, "data.js"), `window.TOKEN_RADAR = ${JSON.stringify(data, null, 2)};\n`, "utf8");

  // Dashboard: copied verbatim, then capped before the dossier is built.
  const dashboardSrc = join(REPO_ROOT, "dashboard");
  const dashboardDst = join(output, "dashboard");
  cpSync(dashboardSrc, dashboardDst, { recursive: true });
  const dashboardSize = countFiles(dashboardDst);
  if (dashboardSize.files > DASHBOARD_MAX_FILES) {
    fail(`dashboard has ${dashboardSize.files} files, over the ${DASHBOARD_MAX_FILES} cap`);
  }
  if (dashboardSize.bytes > DASHBOARD_MAX_BYTES) {
    fail(`dashboard is ${dashboardSize.bytes} bytes, over the ${DASHBOARD_MAX_BYTES} cap`);
  }

  // Screenshots: copied verbatim, gated on count, magic bytes and size.
  const screenshotsSrc = join(REPO_ROOT, "screenshots");
  const screenshotsDst = join(output, "screenshots");
  validateScreenshots(screenshotsSrc);
  cpSync(screenshotsSrc, screenshotsDst, { recursive: true });

  // Dossier: built by the kit library from the finished output tree.
  const dossier = buildDossier(output, {
    text_max_bytes: DOSSIER_TEXT_MAX_BYTES,
    screenshot_max_bytes: SCREENSHOT_MAX_BYTES,
    screenshot_max_count: SCREENSHOT_MAX_COUNT,
    dashboard_max_files: DASHBOARD_MAX_FILES,
    dashboard_max_bytes: DASHBOARD_MAX_BYTES,
  });
  const dossierBytes = Buffer.from(dossier as Uint8Array);
  if (dossierBytes.length > DOSSIER_MAX_BYTES) {
    fail(`dossier is ${dossierBytes.length} bytes, over the ${DOSSIER_MAX_BYTES} cap`);
  }
  writeFileSync(join(output, "dossier.json"), dossierBytes);

  console.log(
    `token-radar-01: ${board.rows.length} rows (${board.meta.watchlist_rows} watchlist + ${board.meta.early_rows} early), ` +
      `${board.trading.length} trading, total implied $${board.meta.total_implied_usd.toLocaleString("en-US")}, ` +
      `dossier ${dossierBytes.length} bytes -> ${output}`,
  );
}

main();
