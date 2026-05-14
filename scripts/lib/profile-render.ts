/**
 * Render profile-stats JSON → README fragment + metrics SVG.
 */

import type { ProfileStats } from "./profile-stats.ts";
import type { DownloadsStats } from "./downloads-stats.ts";
import { sumCratesAllTime, sumNpmWeekly } from "./downloads-stats.ts";

function escXml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function fmt(n: number | null | undefined, fallback = "—"): string {
  if (n == null || !Number.isFinite(n)) return fallback;
  return String(n);
}

function n0(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

export function statsToTextLines(s: ProfileStats): string[] {
  const lines: string[] = [];
  const title = s.name ? `${s.name} (@${s.login})` : `@${s.login}`;
  lines.push(title);
  if (s.location) lines.push(`📍 ${s.location}`);
  lines.push(
    `followers ${s.counts.followers}  ·  following ${s.counts.following}  ·  public repos ${s.counts.publicNonForkRepos}`,
  );
  lines.push(
    `stars on your repos ${fmt(s.counts.starsReceivedOnOwnedNonForkRepos)}  ·  stars given ${s.counts.starsGiven}  ·  releases ${fmt(s.counts.releasesOnOwnedNonForkRepos)}`,
  );
  const w = s.activityWindow;
  lines.push(
    `~1y public index: commits ${fmt(w.commitsMatchingSearchIndex)}  ·  PRs opened ${fmt(w.pullRequestsCreated)}`,
  );
  const ca = s.contributionsApi;
  lines.push(
    `contributions API: calendar ${ca.contributionCalendar.totalContributions}  ·  commits ${ca.totalCommitContributions}  ·  PRs ${ca.totalPullRequestContributions}`,
  );
  if (s.topPublicReposByStars.length) {
    lines.push("top public repos:");
    for (const r of s.topPublicReposByStars.slice(0, 6)) {
      lines.push(`  ${r.nameWithOwner} ★${r.stargazerCount}`);
    }
  }
  lines.push(`updated ${s.generatedAt.slice(0, 16).replace("T", " ")}Z`);
  return lines;
}

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

export function statsToMetricsSvg(
  s: ProfileStats,
  opts?: { width?: number; downloads?: DownloadsStats | null },
): string {
  const width = opts?.width ?? 1280;
  const height = 940;
  const font = "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif";
  const title = s.name ?? s.login;
  const updated = `Updated ${s.generatedAt.slice(0, 16).replace("T", " ")}Z`;
  const heat = s.contributionsApi.weeklyHeatmapBuckets.slice(-53);
  const topRepos = s.topPublicReposByStars.slice(0, 6);
  const recentStars = s.recentStarsGiven.slice(0, 3);

  const leftX = 28;
  const leftW = 330;
  const mainX = leftX + leftW + 26;
  const mainW = width - mainX - 28;
  const topY = 28;
  const graphY = 452;
  const labelColor = "#aab6c8";

  const chartX = mainX + 26;
  const chartY = graphY + 56;
  const chartW = mainW - 52;
  const chartH = 128;
  const points: string[] = [];
  const maxBucket = Math.max(1, ...heat);
  for (let i = 0; i < Math.max(1, heat.length); i++) {
    const v = heat[i] ?? 0;
    const x = chartX + (i * chartW) / Math.max(1, heat.length - 1);
    const y = chartY + chartH - (v / maxBucket) * (chartH - 14);
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  const fillPath = `M ${chartX} ${chartY + chartH} L ${points.join(" L ")} L ${chartX + chartW} ${chartY + chartH} Z`;

  const parts: string[] = [];
  parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
  parts.push(`<defs>`);
  parts.push(`<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0a0f1f"/><stop offset="50%" stop-color="#0b1324"/><stop offset="100%" stop-color="#0a0f18"/></linearGradient>`);
  parts.push(`<linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#2ea043" stop-opacity="0.65"/><stop offset="100%" stop-color="#2ea043" stop-opacity="0.04"/></linearGradient>`);
  parts.push(`</defs>`);
  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="url(#bg)"/>`);

  parts.push(`<rect x="${leftX}" y="${topY}" width="${leftW}" height="${height - 56}" rx="14" fill="#0b1220" stroke="#2b3448"/>`);
  parts.push(`<circle cx="${leftX + 36}" cy="${topY + 34}" r="20" fill="#121a2a" stroke="#55607a"/>`);
  parts.push(`<text x="${leftX + 36}" y="${topY + 40}" text-anchor="middle" font-family="${font}" font-size="18" font-weight="700" fill="#e6edf3">G</text>`);
  parts.push(`<text x="${leftX + 78}" y="${topY + 30}" font-family="${font}" font-size="20" font-weight="700" fill="#e6edf3">${escXml(title)}</text>`);
  parts.push(`<text x="${leftX + 78}" y="${topY + 56}" font-family="${font}" font-size="18" fill="#8b949e">@${escXml(s.login)}</text>`);

  let y = topY + 102;
  const line = (label: string, value: string, isHeader = false): void => {
    if (isHeader) {
      parts.push(`<text x="${leftX + 18}" y="${y}" font-family="${font}" font-size="24" font-weight="700" fill="#dce4ef">${escXml(value)}</text>`);
      y += 28;
      return;
    }
    parts.push(`<text x="${leftX + 18}" y="${y}" font-family="${font}" font-size="13" fill="${labelColor}">${escXml(label)}</text>`);
    parts.push(`<text x="${leftX + leftW - 18}" y="${y}" text-anchor="end" font-family="${font}" font-size="13" fill="#e6edf3">${escXml(value)}</text>`);
    y += 24;
  };
  line("", "Profile", true);
  line("Followers", fmt(s.counts.followers));
  line("Following", fmt(s.counts.following));
  line("Public repos", fmt(s.counts.publicNonForkRepos));
  if (s.location) line("Location", s.location);
  if (s.websiteUrl) line("Website", clip(s.websiteUrl, 30));

  const downloads = opts?.downloads ?? null;
  if (downloads) {
    const npmTotal = sumNpmWeekly(downloads);
    const cratesTotal = sumCratesAllTime(downloads);
    const topNpm = [...downloads.npm.packages]
      .filter((p) => (p.weeklyDownloads ?? 0) > 0)
      .sort((a, b) => (b.weeklyDownloads ?? 0) - (a.weeklyDownloads ?? 0))
      .slice(0, 4);
    const topCrates = [...downloads.crates.crates]
      .filter((c) => (c.allTimeDownloads ?? 0) > 0)
      .sort((a, b) => (b.allTimeDownloads ?? 0) - (a.allTimeDownloads ?? 0))
      .slice(0, 4);

    y += 12;
    line("", "Packages", true);
    line(`npm (~${downloads.npm.packages.length})`, `${fmtCompact(npmTotal)}/wk`);
    for (const p of topNpm) {
      line(`  ${clip(p.name, 26)}`, fmtCompact(p.weeklyDownloads ?? 0));
    }
    y += 6;
    line(`crates.io (${downloads.crates.crates.length})`, fmtCompact(cratesTotal));
    for (const c of topCrates) {
      line(`  ${clip(c.name, 26)}`, fmtCompact(c.allTimeDownloads ?? 0));
    }
  }

  parts.push(`<rect x="${mainX}" y="${topY + 56}" width="${mainW}" height="370" rx="12" fill="#0b1220" stroke="#2b3448"/>`);
  const gap = 18;
  const cardW = Math.floor((mainW - gap * 4) / 3);
  const cardX1 = mainX + gap;
  const cardX2 = cardX1 + cardW + gap;
  const cardX3 = cardX2 + cardW + gap;
  const cardY = topY + 78;
  const cardH = 326;
  const metricCard = (x: number, heading: string): void => {
    parts.push(`<rect x="${x}" y="${cardY}" width="${cardW}" height="${cardH}" rx="10" fill="#101a2d" stroke="#34425f"/>`);
    parts.push(`<text x="${x + 16}" y="${cardY + 30}" font-family="${font}" font-size="16" font-weight="700" fill="#e6edf3">${escXml(heading)}</text>`);
  };
  metricCard(cardX1, "Contribution Mix");
  metricCard(cardX2, "Momentum");
  metricCard(cardX3, "Repo Star Ranking");

  // Render recent stars as compact chips near the top of the main panel.
  const chipsY = topY + 60;
  parts.push(`<text x="${mainX + 20}" y="${chipsY}" font-family="${font}" font-size="12" fill="${labelColor}">Recent stars</text>`);
  let chipX = mainX + 98;
  for (let i = 0; i < recentStars.length; i++) {
    const label = clip(recentStars[i].nameWithOwner, 22);
    const chipW = Math.min(220, Math.max(90, 16 + label.length * 7));
    parts.push(`<rect x="${chipX}" y="${chipsY - 12}" width="${chipW}" height="20" rx="10" fill="#18233a" stroke="#2b3c5d"/>`);
    parts.push(`<text x="${chipX + 10}" y="${chipsY + 2}" font-family="${font}" font-size="12" fill="#cdd8e5">${escXml(label)}</text>`);
    chipX += chipW + 8;
    if (chipX > mainX + mainW - 220) break;
  }

  const mixRows: Array<[string, number, string]> = [
    ["Commits", Math.max(n0(s.contributionsApi.totalCommitContributions), n0(s.activityWindow.commitsMatchingSearchIndex))],
    ["Issues", Math.max(n0(s.contributionsApi.totalIssueContributions), n0(s.activityWindow.issuesCreated))],
    ["PRs", Math.max(n0(s.contributionsApi.totalPullRequestContributions), n0(s.activityWindow.pullRequestsCreated))],
    ["Reviews", Math.max(n0(s.contributionsApi.totalPullRequestReviewContributions), n0(s.activityWindow.pullRequestsReviewed))],
  ].map((v, i) => [v[0], v[1], ["#4f8df7", "#22c55e", "#a855f7", "#f59e0b"][i]]);

  let mixY = cardY + 82;
  const mixTotal = mixRows.reduce((sum, row) => sum + row[1], 0) || 1;
  const stackX = cardX1 + 16;
  const stackW = cardW - 32;
  let cursor = stackX;
  for (const [, value, color] of mixRows) {
    const segW = Math.max(2, Math.round((value / mixTotal) * stackW));
    parts.push(`<rect x="${cursor}" y="${cardY + 52}" width="${segW}" height="10" rx="4" fill="${color}"/>`);
    cursor += segW;
  }
  for (const [label, value, color] of mixRows) {
    parts.push(`<circle cx="${cardX1 + 20}" cy="${mixY - 4}" r="4" fill="${color}"/>`);
    parts.push(`<text x="${cardX1 + 32}" y="${mixY}" font-family="${font}" font-size="14" fill="#cdd8e5">${escXml(String(label))}</text>`);
    parts.push(`<text x="${cardX1 + cardW - 16}" y="${mixY}" text-anchor="end" font-family="${font}" font-size="14" fill="#e6edf3">${value}</text>`);
    mixY += 44;
  }

  const momentumRows = [
    ["~1y PRs opened", fmt(s.activityWindow.pullRequestsCreated)],
    ["~1y issues opened", fmt(s.activityWindow.issuesCreated)],
    ["~1y reviews", fmt(s.activityWindow.pullRequestsReviewed)],
    ["Releases", fmt(s.counts.releasesOnOwnedNonForkRepos)],
    ["Stars given", fmt(s.counts.starsGiven)],
    ["Stars on repos", fmt(s.counts.starsReceivedOnOwnedNonForkRepos)],
  ];
  let mY = cardY + 64;
  for (const [label, value] of momentumRows) {
    parts.push(`<text x="${cardX2 + 16}" y="${mY}" font-family="${font}" font-size="14" fill="${labelColor}">${escXml(label)}</text>`);
    parts.push(`<text x="${cardX2 + cardW - 16}" y="${mY}" text-anchor="end" font-family="${font}" font-size="14" fill="#e6edf3">${escXml(value)}</text>`);
    mY += 34;
  }

  const maxStars = Math.max(1, ...topRepos.map((r) => r.stargazerCount));
  let rY = cardY + 64;
  for (let i = 0; i < Math.min(5, topRepos.length); i++) {
    const r = topRepos[i];
    const barW = Math.max(6, Math.floor((r.stargazerCount / maxStars) * (cardW - 120)));
    parts.push(`<text x="${cardX3 + 16}" y="${rY}" font-family="${font}" font-size="14" fill="#cdd8e5">${i + 1}</text>`);
    parts.push(`<text x="${cardX3 + 34}" y="${rY}" font-family="${font}" font-size="14" fill="#cdd8e5">${escXml(clip(r.nameWithOwner.split("/")[1] ?? r.nameWithOwner, 16))}</text>`);
    parts.push(`<text x="${cardX3 + cardW - 16}" y="${rY}" text-anchor="end" font-family="${font}" font-size="14" fill="#e6edf3">${r.stargazerCount}</text>`);
    parts.push(`<line x1="${cardX3 + 34}" y1="${rY + 1}" x2="${cardX3 + cardW - 34}" y2="${rY + 1}" stroke="#24304a"/>`);
    parts.push(`<rect x="${cardX3 + 34}" y="${rY + 8}" width="${cardW - 90}" height="7" rx="3.5" fill="#1a253a"/>`);
    parts.push(`<rect x="${cardX3 + 34}" y="${rY + 8}" width="${barW}" height="7" rx="3.5" fill="#8b5cf6"/>`);
    rY += 50;
  }

  parts.push(`<rect x="${mainX}" y="${graphY}" width="${mainW}" height="300" rx="12" fill="#0b1220" stroke="#2b3448"/>`);
  parts.push(`<text x="${mainX + 24}" y="${graphY + 34}" font-family="${font}" font-size="18" fill="#dce4ef">Recent activity</text>`);
  for (let i = 0; i < 5; i++) {
    const gy = chartY + (i * chartH) / 4;
    parts.push(`<line x1="${chartX}" y1="${gy}" x2="${chartX + chartW}" y2="${gy}" stroke="#2b3448" stroke-dasharray="2 8"/>`);
  }
  const isFlat = heat.every((v) => v === 0);
  if (!isFlat) {
    parts.push(`<path d="${fillPath}" fill="url(#chartFill)"/>`);
    parts.push(`<polyline points="${points.join(" ")}" fill="none" stroke="#7ee787" stroke-width="1.5"/>`);
  } else {
    parts.push(`<text x="${chartX + chartW / 2}" y="${chartY + chartH / 2}" text-anchor="middle" font-family="${font}" font-size="15" fill="${labelColor}">No recent contribution detail available from API token.</text>`);
  }
  parts.push(`<line x1="${chartX}" y1="${chartY + chartH}" x2="${chartX + chartW}" y2="${chartY + chartH}" stroke="#93a1b7"/>`);
  const cell = 9;
  const hGap = 4;
  const hX = chartX;
  const hY = chartY + chartH + 24;
  const palette = ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"];
  for (let i = 0; i < 53; i++) {
    const bucket = heat[i] ?? 0;
    parts.push(`<rect x="${hX + i * (cell + hGap)}" y="${hY}" width="${cell}" height="${cell}" rx="2" fill="${palette[bucket] ?? palette[0]}"/>`);
  }
  parts.push(`<text x="${mainX + mainW - 24}" y="${graphY + 262}" text-anchor="end" font-family="${font}" font-size="14" fill="${labelColor}">${escXml(updated)}</text>`);
  if (s.websiteUrl) {
    parts.push(`<text x="${mainX + mainW - 24}" y="${graphY + 262}" text-anchor="end" font-family="${font}" font-size="14" fill="#58a6ff">${escXml(s.websiteUrl)}</text>`);
  }
  parts.push(`</svg>`);
  return `${parts.join("\n")}\n`;
}

export function assembleReadme(
  statsImagePath: string,
  bioMarkdown: string,
  cacheBust?: string | null,
): string {
  const img = statsImagePath.trim() || "/github-metrics.svg";
  const v = (cacheBust ?? "").replace(/[^a-zA-Z0-9._-]/g, "");
  const url = v ? `${img}${img.includes("?") ? "&" : "?"}v=${v}` : img;
  const lines = [`![Stats](${url})`, "", bioMarkdown.trimEnd(), ""];
  return lines.join("\n");
}

export function parseProfileStatsJson(raw: string): ProfileStats {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON.");
  }
  if (typeof v !== "object" || v === null || !("login" in v) || !("counts" in v)) {
    throw new Error("JSON does not look like profile stats (need login, counts, …).");
  }
  return v as ProfileStats;
}
