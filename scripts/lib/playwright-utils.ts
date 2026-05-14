/**
 * Shared Playwright helpers (worker pools, browser defaults).
 */

import type { BrowserContext, Page } from "playwright";

/** Max concurrent tabs per pool — each worker owns one Page (never share one Page across parallel gotos). */
export const PLAYWRIGHT_SCRAPE_CONCURRENCY = 4;

export const PLAYWRIGHT_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";

/**
 * Run `worker` over `items` using up to `concurrency` dedicated Pages; results align with `items` indices.
 */
export async function mapWithDedicatedPages<T, R>(
  ctx: BrowserContext,
  items: readonly T[],
  worker: (page: Page, item: T, index: number) => Promise<R>,
  concurrency: number = PLAYWRIGHT_SCRAPE_CONCURRENCY,
): Promise<R[]> {
  if (items.length === 0) return [];
  const workers = Math.min(concurrency, items.length);
  const pages = await Promise.all(Array.from({ length: workers }, () => ctx.newPage()));
  const results: R[] = new Array(items.length);
  let next = 0;

  async function run(page: Page): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(page, items[i]!, i);
    }
  }

  try {
    await Promise.all(pages.map((p) => run(p)));
  } finally {
    await Promise.all(pages.map((p) => p.close().catch(() => {})));
  }
  return results;
}
