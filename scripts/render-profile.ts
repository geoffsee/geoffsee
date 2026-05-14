#!/usr/bin/env bun
/**
 * Render profile-stats JSON → github-metrics.svg + README.md
 *
 * Usage:
 *   bun scripts/render-profile.ts stats.json
 *   bun scripts/gh-profile-stats.ts --json | bun scripts/render-profile.ts --stdin
 *
 * For live data, `bun scripts/gh-profile-stats.ts` already writes the SVG and README in one pass.
 *
 * Options (defaults for profile repo layout):
 *   --svg PATH          default: ./github-metrics.svg
 *   --readme PATH       default: ./README.md
 *   --bio PATH          default: ./assets/bio.md
 *   --image-ref PATH    README image path; default: /github-metrics.svg
 */

import {
  assembleReadme,
  parseProfileStatsJson,
  statsToMetricsSvg,
} from "./lib/profile-render.ts";
import { parseDownloadsStatsJson, type DownloadsStats } from "./lib/downloads-stats.ts";

function parseArgs(argv: string[]) {
  let stdin = false;
  let inputPath: string | null = null;
  let svg = "github-metrics.svg";
  let readme = "README.md";
  let bio = "assets/bio.md";
  let imageRef = "/github-metrics.svg";
  let downloadsPath: string | null = null;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") help = true;
    else if (a === "--stdin") stdin = true;
    else if (a === "--svg") svg = argv[++i] ?? "";
    else if (a === "--readme") readme = argv[++i] ?? "";
    else if (a === "--bio") bio = argv[++i] ?? "";
    else if (a === "--image-ref") imageRef = argv[++i] ?? "";
    else if (a === "--downloads") downloadsPath = argv[++i] ?? "";
    else if (a.startsWith("-")) {
      console.error(`Unknown flag: ${a}`);
      process.exit(2);
    } else if (!inputPath) inputPath = a;
    else {
      console.error("Too many positional arguments.");
      process.exit(2);
    }
  }

  return { stdin, inputPath, svg, readme, bio, imageRef, downloadsPath, help };
}

const { stdin, inputPath, svg, readme, bio, imageRef, downloadsPath, help } = parseArgs(process.argv.slice(2));
if (help) {
  console.log(`Usage: bun scripts/render-profile.ts [options] [stats.json]
  --stdin       read JSON from stdin
  --svg PATH    output SVG (default github-metrics.svg)
  --readme PATH output README (default README.md)
  --bio PATH    markdown after the stats image (default assets/bio.md)
  --image-ref   path used in ![Stats](...) (default /github-metrics.svg)
  --downloads PATH  optional downloads JSON to overlay in SVG`);
  process.exit(0);
}

if (stdin === !!inputPath) {
  console.error("Provide exactly one of: stats.json path OR --stdin");
  process.exit(2);
}

let raw: string;
if (stdin) {
  raw = await Bun.stdin.text();
} else {
  const f = Bun.file(inputPath!);
  if (!(await f.exists())) {
    console.error(`Not found: ${inputPath}`);
    process.exit(1);
  }
  raw = await f.text();
}

const stats = parseProfileStatsJson(raw);

let downloads: DownloadsStats | null = null;
if (downloadsPath) {
  const f = Bun.file(downloadsPath);
  if (!(await f.exists())) {
    console.error(`Not found: ${downloadsPath}`);
    process.exit(1);
  }
  downloads = parseDownloadsStatsJson(await f.text());
}

const svgOut = statsToMetricsSvg(stats, { downloads });
await Bun.write(svg, svgOut);

const bioFile = Bun.file(bio);
const bioText = (await bioFile.exists()) ? await bioFile.text() : "";
const cacheBust = Bun.hash(svgOut).toString(36).slice(0, 8);
const readmeOut = assembleReadme(imageRef, bioText, cacheBust);
await Bun.write(readme, readmeOut);

console.error(`Wrote ${svg} (${svgOut.length} bytes) and ${readme}`);
