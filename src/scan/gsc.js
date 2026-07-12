// =============================================================================
// GSC Scanner — Google Search Console Data Fetcher
// =============================================================================
// Fetches top queries, top pages, and daily totals from Google Search Console
// for two sites (gotripmate.com and voyageally.com) using JWT service account
// authentication. Part of the Daily SEO Auto-Optimization Loop.
// =============================================================================

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const DATA_RANKINGS = path.join(PROJECT_ROOT, "data", "rankings");

/**
 * Parse a GSC private-key env-var value that may contain literal "\n" escape
 * sequences (as GitHub Secrets often inject them) into a real multi-line PEM.
 */
function normalizePrivateKey(raw) {
  if (!raw) return null;
  // Replace literal '\n' (two characters) with actual newlines
  let key = raw.replace(/\\n/g, "\n");
  // If the key still doesn't start with "-----BEGIN", try wrapping it
  if (!key.includes("-----BEGIN PRIVATE KEY-----")) {
    key =
      "-----BEGIN PRIVATE KEY-----\n" +
      key.trim().replace(/\s+/g, "\n") +
      "\n-----END PRIVATE KEY-----";
  }
  return key;
}

/**
 * Build a JWT-authenticated Search Console client.
 */
function createGscClient(clientEmail, privateKey) {
  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
  });

  return google.searchconsole({ version: "v1", auth });
}

// ---------------------------------------------------------------------------
// Data-fetching functions
// ---------------------------------------------------------------------------

/**
 * Fetch top 100 queries for the last N days.
 */
async function fetchTopQueries(gsc, siteUrl, days = 7) {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = endDate.toISOString().slice(0, 10);

  const response = await gsc.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate: startStr,
      endDate: endStr,
      dimensions: ["query"],
      rowLimit: 100,
    },
  });

  const rows = response.data.rows || [];
  return rows.map((row) => ({
    query: row.keys[0],
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    ctr: row.ctr ?? 0,
    position: row.position ?? 0,
  }));
}

/**
 * Fetch top 50 pages for the last N days.
 */
async function fetchTopPages(gsc, siteUrl, days = 7) {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = endDate.toISOString().slice(0, 10);

  const response = await gsc.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate: startStr,
      endDate: endStr,
      dimensions: ["page"],
      rowLimit: 50,
    },
  });

  const rows = response.data.rows || [];
  return rows.map((row) => ({
    page: row.keys[0],
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    ctr: row.ctr ?? 0,
    position: row.position ?? 0,
  }));
}

/**
 * Fetch daily aggregate totals for the last N days.
 */
async function fetchDailyTotals(gsc, siteUrl, days = 7) {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = endDate.toISOString().slice(0, 10);

  const response = await gsc.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate: startStr,
      endDate: endStr,
      dimensions: ["date"],
      rowLimit: days,
    },
  });

  const rows = response.data.rows || [];
  return rows.map((row) => ({
    date: row.keys[0],
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// File I/O helpers
// ---------------------------------------------------------------------------

/** Ensure a directory exists. */
async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * Read a JSON file, returning `defaultValue` if it doesn't exist or is
 * unparseable.
 */
async function readJson(filePath, defaultValue = null) {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return defaultValue;
  }
}

/** Write a JSON file (pretty-printed). */
async function writeJson(filePath, data) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function scanGsc() {
  console.log("=".repeat(60));
  console.log("GSC Scanner — Starting");
  console.log("=".repeat(60));

  // ---- Read env config ---------------------------------------------------
  const clientEmail = process.env.GSC_CLIENT_EMAIL;
  const privateKeyRaw = process.env.GSC_PRIVATE_KEY;
  const siteUrlGtm = process.env.GSC_SITE_URL_GTM;
  const siteUrlVa = process.env.GSC_SITE_URL_VA;

  if (!clientEmail || !privateKeyRaw) {
    console.error("❌ Missing GSC_CLIENT_EMAIL or GSC_PRIVATE_KEY env vars");
    return;
  }
  if (!siteUrlGtm || !siteUrlVa) {
    console.error("❌ Missing GSC_SITE_URL_GTM or GSC_SITE_URL_VA env vars");
    return;
  }

  const privateKey = normalizePrivateKey(privateKeyRaw);
  if (!privateKey) {
    console.error("❌ Could not parse GSC_PRIVATE_KEY");
    return;
  }

  // ---- Auth & client ----------------------------------------------------
  let gsc;
  try {
    gsc = createGscClient(clientEmail, privateKey);
    // Force a token refresh to validate credentials early
    await gsc.context._options.auth.getAccessToken();
    console.log("✅ GSC JWT auth successful");
  } catch (err) {
    console.error("❌ GSC auth failed:", err.message);
    return;
  }

  const sites = [
    { name: "gotripmate", url: siteUrlGtm },
    { name: "voyageally", url: siteUrlVa },
  ];

  const combinedRankings = [];
  const today = new Date().toISOString().slice(0, 10);
  let totalQueries = 0;
  let totalPages = 0;

  for (const site of sites) {
    console.log(`\n--- Site: ${site.name} (${site.url}) ---`);

    try {
      // ---- Fetch data ----------------------------------------------------
      const [queries, pages, dailyTotals] = await Promise.all([
        fetchTopQueries(gsc, site.url),
        fetchTopPages(gsc, site.url),
        fetchDailyTotals(gsc, site.url),
      ]);

      totalQueries += queries.length;
      totalPages += pages.length;

      console.log(
        `  ✅ Queries: ${queries.length}, Pages: ${pages.length}, Days: ${dailyTotals.length}`
      );

      // ---- Build site-specific snapshot ----------------------------------
      const snapshot = {
        site: site.name,
        siteUrl: site.url,
        fetchedAt: new Date().toISOString(),
        date: today,
        queries,
        pages,
        dailyTotals,
      };

      // Write per-site file
      const siteFile = path.join(DATA_RANKINGS, `site-${site.name}.json`);
      await writeJson(siteFile, snapshot);
      console.log(`  📁 Wrote ${siteFile}`);

      // Add to combined
      combinedRankings.push(snapshot);
    } catch (err) {
      console.error(`  ❌ Error fetching data for ${site.name}:`, err.message);
    }
  }

  // ---- Write combined "rankings-today.json" ------------------------------
  const todayFile = path.join(DATA_RANKINGS, "rankings-today.json");
  const todayPayload = {
    fetchedAt: new Date().toISOString(),
    date: today,
    sites: combinedRankings,
  };
  await writeJson(todayFile, todayPayload);
  console.log(`\n📁 Wrote ${todayFile}`);

  // ---- Append to "rankings-history.json" (rolling 90 days) --------------
  const historyFile = path.join(DATA_RANKINGS, "rankings-history.json");
  const existingHistory = await readJson(historyFile, []);

  // Append today's entry
  existingHistory.push({
    fetchedAt: new Date().toISOString(),
    date: today,
    sites: combinedRankings.map((s) => ({
      site: s.site,
      queries: s.queries,
      pages: s.pages,
      dailyTotals: s.dailyTotals,
    })),
  });

  // Sort by date descending and keep last 90 days
  existingHistory.sort((a, b) => b.date.localeCompare(a.date));
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const pruned = existingHistory.filter((entry) => entry.date >= cutoffStr);

  await writeJson(historyFile, pruned);
  console.log(`📁 Wrote ${historyFile} (${pruned.length} entries, rolling 90 days)`);

  // ---- Summary -----------------------------------------------------------
  console.log("\n" + "=".repeat(60));
  console.log("GSC Scan Summary");
  console.log("=".repeat(60));
  console.log(`  Sites fetched     : ${sites.length}`);
  console.log(`  Total queries     : ${totalQueries}`);
  console.log(`  Total pages       : ${totalPages}`);
  console.log(`  Date              : ${today}`);
  console.log("=".repeat(60));

  return { success: true, totalQueries, totalPages, date: today };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

// When run directly via `node src/scan/gsc.js`
const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  scanGsc().catch((err) => {
    console.error("Unhandled error in gsc scan:", err);
    process.exit(1);
  });
}
