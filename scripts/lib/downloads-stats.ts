/**
 * Scrape npm + crates.io profile pages with Playwright to collect package
 * download counts.
 *
 * Requires: playwright (and `bunx playwright install chromium`).
 */

import { chromium, type Browser, type Page } from "playwright";

export type NpmPackage = {
  name: string;
  version: string | null;
  weeklyDownloads: number | null;
};

export type Crate = {
  name: string;
  version: string | null;
  allTimeDownloads: number | null;
  recentDownloads: number | null;
};

export type DownloadsStats = {
  generatedAt: string;
  npm: { user: string; packages: NpmPackage[] };
  crates: { user: string; crates: Crate[] };
};

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";

function parseIntLoose(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.replace(/,/g, "").match(/-?\d+/);
  return m ? parseInt(m[0], 10) : null;
}

async function collectNpmPackageNames(page: Page, user: string): Promise<string[]> {
  const names = new Set<string>();
  let pageIdx = 0;
  while (true) {
    const url = `https://www.npmjs.com/~${encodeURIComponent(user)}?page=${pageIdx}`;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const { pageNames, hasNext } = await page.evaluate(() => {
      const found: string[] = [];
      document.querySelectorAll('a[href^="/package/"]').forEach((a) => {
        const href = a.getAttribute("href") || "";
        const name = href.replace(/^\/package\//, "").split(/[?#]/)[0];
        if (name) found.push(name);
      });
      const next = !!document.querySelector('a[rel="next"], a[aria-label="Next page"]');
      return { pageNames: found, hasNext: next };
    });
    const before = names.size;
    for (const n of pageNames) names.add(n);
    if (!hasNext || names.size === before) break;
    pageIdx++;
  }
  return [...names];
}

async function fetchNpmPackageStats(page: Page, name: string): Promise<NpmPackage> {
  await page.goto(`https://www.npmjs.com/package/${name}`, { waitUntil: "domcontentloaded" });
  await page
    .waitForFunction(() => /Weekly Downloads[\s\S]{0,40}\d/.test(document.body.innerText), null, {
      timeout: 15000,
    })
    .catch(() => {});
  const data = await page.evaluate(() => {
    const t = document.body.innerText;
    const weeklyMatch = t.match(/Weekly Downloads\s*([\d,]+)/i);
    const versionMatch = t.match(/\bVersion\b\s*([^\s\n]+)/);
    return {
      weekly: weeklyMatch ? weeklyMatch[1] : null,
      version: versionMatch ? versionMatch[1] : null,
    };
  });
  return {
    name,
    version: data.version,
    weeklyDownloads: parseIntLoose(data.weekly),
  };
}

async function collectCrates(page: Page, user: string): Promise<Crate[]> {
  const crates: Crate[] = [];
  let pageIdx = 1;
  while (true) {
    const url = `https://crates.io/users/${encodeURIComponent(user)}?page=${pageIdx}`;
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForSelector('a[href^="/crates/"]', { timeout: 15000 }).catch(() => {});

    const result = await page.evaluate(() => {
      const items: { name: string; version: string | null; allTime: string | null; recent: string | null }[] = [];
      const seen = new Set<string>();
      document.querySelectorAll('a[href^="/crates/"]').forEach((a) => {
        const href = a.getAttribute("href") || "";
        const m = href.match(/^\/crates\/([^/?#]+)$/);
        if (!m) return;
        const name = m[1];
        if (seen.has(name)) return;
        const row = a.closest("li, article");
        if (!row) return;
        const text = (row as HTMLElement).innerText || "";
        const versionMatch = text.match(/\bv([^\s\n]+)/);
        const allTimeMatch = text.match(/All-?Time:\s*([\d,]+)/i);
        const recentMatch = text.match(/Recent:\s*([\d,]+)/i);
        if (!allTimeMatch && !recentMatch) return;
        seen.add(name);
        items.push({
          name,
          version: versionMatch ? versionMatch[1] : null,
          allTime: allTimeMatch ? allTimeMatch[1] : null,
          recent: recentMatch ? recentMatch[1] : null,
        });
      });
      const total = (document.body.innerText.match(/of\s+(\d+)\s+total/i) || [])[1] || null;
      return { items, total };
    });

    if (result.items.length === 0) break;
    const before = crates.length;
    for (const it of result.items) {
      if (crates.some((c) => c.name === it.name)) continue;
      crates.push({
        name: it.name,
        version: it.version,
        allTimeDownloads: parseIntLoose(it.allTime),
        recentDownloads: parseIntLoose(it.recent),
      });
    }
    const total = result.total ? parseInt(result.total, 10) : null;
    if (total !== null && crates.length >= total) break;
    if (crates.length === before) break;
    pageIdx++;
  }
  return crates;
}

export async function collectDownloadsStats(opts: {
  npmUser: string;
  cratesUser: string;
  headed?: boolean;
  onProgress?: (msg: string) => void;
}): Promise<DownloadsStats> {
  const log = opts.onProgress ?? (() => {});
  const browser: Browser = await chromium.launch({ headless: !opts.headed });
  const ctx = await browser.newContext({ userAgent: USER_AGENT });
  const page = await ctx.newPage();
  try {
    log(`Collecting npm packages for ${opts.npmUser}...`);
    const names = await collectNpmPackageNames(page, opts.npmUser);
    log(`Found ${names.length} npm packages; fetching weekly downloads...`);
    const npmPackages: NpmPackage[] = [];
    for (const name of names) {
      let stats = await fetchNpmPackageStats(page, name);
      if (stats.weeklyDownloads === null) stats = await fetchNpmPackageStats(page, name);
      npmPackages.push(stats);
      log(`  ${stats.name}: ${stats.weeklyDownloads ?? "?"}/wk`);
    }
    npmPackages.sort((a, b) => (b.weeklyDownloads ?? -1) - (a.weeklyDownloads ?? -1));

    log(`Collecting crates for ${opts.cratesUser}...`);
    const crates = await collectCrates(page, opts.cratesUser);
    log(`Found ${crates.length} crates.`);
    crates.sort((a, b) => (b.allTimeDownloads ?? -1) - (a.allTimeDownloads ?? -1));

    return {
      generatedAt: new Date().toISOString(),
      npm: { user: opts.npmUser, packages: npmPackages },
      crates: { user: opts.cratesUser, crates },
    };
  } finally {
    await browser.close();
  }
}

export function sumNpmWeekly(stats: DownloadsStats): number {
  return stats.npm.packages.reduce((sum, p) => sum + (p.weeklyDownloads ?? 0), 0);
}

export function sumCratesAllTime(stats: DownloadsStats): number {
  return stats.crates.crates.reduce((sum, c) => sum + (c.allTimeDownloads ?? 0), 0);
}

export function parseDownloadsStatsJson(raw: string): DownloadsStats {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    throw new Error("Invalid downloads JSON.");
  }
  if (
    typeof v !== "object" ||
    v === null ||
    !("npm" in v) ||
    !("crates" in v)
  ) {
    throw new Error("JSON does not look like downloads stats (need npm, crates).");
  }
  return v as DownloadsStats;
}
