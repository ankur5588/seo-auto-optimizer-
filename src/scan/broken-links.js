// =============================================================================
// Broken Links Scanner
// =============================================================================
// Crawls the homepage and sitemap.xml for each site, extracts internal links,
// and checks each with a HEAD request to identify broken (4xx/5xx) URLs.
// Part of the Daily SEO Auto-Optimization Loop.
// =============================================================================

import { promises as fs } from "node:fs";
import https from "node:https";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const DATA_AUDITS = path.join(PROJECT_ROOT, "data", "audits");

/** Ensure a directory exists. */
async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

/** Write a JSON file (pretty-printed). */
async function writeJson(filePath, data) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * Perform an HTTP/HTTPS GET and return the response body, status, and headers.
 */
function fetchUrl(urlString, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(urlString);
    const mod = urlObj.protocol === "http:" ? http : https;

    const req = mod.get(
      urlString,
      { timeout, rejectUnauthorized: false },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString("utf-8"),
            headers: res.headers,
          });
        });
      }
    );

    req.on("error", (err) => reject(err));
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Request timed out after ${timeout}ms`));
    });
  });
}

/**
 * Perform a HEAD request to check link status. Uses GET as a fallback if HEAD
 * is not allowed (405).
 */
function headUrl(urlString, timeout = 10000) {
  return new Promise((resolve) => {
    const urlObj = new URL(urlString);
    const mod = urlObj.protocol === "http:" ? http : https;

    const start = Date.now();
    const req = mod.request(
      urlString,
      { method: "HEAD", timeout, rejectUnauthorized: false },
      (res) => {
        // Consume response data to free memory
        res.resume();
        resolve({ status: res.statusCode, elapsed: Date.now() - start });
      }
    );

    req.on("error", (_err) => {
      // Fallback to GET if HEAD fails (some servers reject HEAD)
      const getReq = mod.get(
        urlString,
        { timeout, rejectUnauthorized: false },
        (res) => {
          res.resume();
          resolve({ status: res.statusCode, elapsed: Date.now() - start });
        }
      );
      getReq.on("error", (getErr) => {
        resolve({ status: 0, error: getErr.message, elapsed: Date.now() - start });
      });
      getReq.on("timeout", () => {
        getReq.destroy();
        resolve({ status: 0, error: "Timed out", elapsed: Date.now() - start });
      });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({ status: 0, error: "Timed out", elapsed: Date.now() - start });
    });

    req.end();
  });
}

/**
 * Normalize a URL: remove trailing slash for consistency, decode entities, and
 * strip fragment.
 */
function normalizeUrl(rawUrl, baseUrl) {
  try {
    const resolved = new URL(rawUrl, baseUrl);
    // Remove hash fragment
    resolved.hash = "";
    // Normalize trailing slash (preserve for root "/")
    let href = resolved.href;
    if (href.endsWith("/") && href !== baseUrl && href !== `${baseUrl}/`) {
      href = href.replace(/\/$/, "");
    }
    return href;
  } catch {
    return null;
  }
}

/**
 * Determine if a URL is internal to the given domain.
 */
function isInternalLink(href, siteHostname) {
  try {
    const url = new URL(href);
    return url.hostname === siteHostname;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// URL extraction
// ---------------------------------------------------------------------------

/**
 * Extract all <a href="..."> links from HTML using cheerio.
 * Returns an array of absolute, normalized URLs.
 */
function extractLinksFromHtml(html, baseUrl) {
  const $ = cheerio.load(html);
  const links = new Set();

  $("a[href]").each((_i, el) => {
    const href = $(el).attr("href");
    if (!href || href.trim() === "") return;

    // Skip javascript:, mailto:, tel:, and anchor-only links
    const trimmed = href.trim();
    if (
      trimmed.startsWith("javascript:") ||
      trimmed.startsWith("mailto:") ||
      trimmed.startsWith("tel:") ||
      trimmed.startsWith("#") ||
      trimmed === "/"
    ) {
      return;
    }

    const normalized = normalizeUrl(trimmed, baseUrl);
    if (normalized) {
      links.add(normalized);
    }
  });

  return [...links];
}

/**
 * Extract URLs from a sitemap XML text body.
 */
function extractUrlsFromSitemap(xmlBody, baseUrl) {
  const $ = cheerio.load(xmlBody, { xmlMode: true });
  const urls = new Set();

  $("loc").each((_i, el) => {
    const loc = $(el).text().trim();
    if (loc) {
      const normalized = normalizeUrl(loc, baseUrl);
      if (normalized) {
        urls.add(normalized);
      }
    }
  });

  return [...urls];
}

// ---------------------------------------------------------------------------
// Link checking
// ---------------------------------------------------------------------------

/**
 * Check a batch of URLs with HEAD requests.  Uses concurrency control to avoid
 * overwhelming the server.
 */
async function checkLinks(urls, concurrency = 10) {
  const results = [];
  const queue = [...urls];
  let idx = 0;

  async function worker() {
    while (idx < queue.length) {
      const url = queue[idx++];
      try {
        const head = await headUrl(url);
        const isBroken = head.status >= 400 || head.status === 0;

        results.push({
          url,
          status: head.status,
          broken: isBroken,
          error: head.error || null,
          elapsedMs: head.elapsed,
        });
      } catch (err) {
        results.push({
          url,
          status: 0,
          broken: true,
          error: err.message,
          elapsedMs: null,
        });
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, urls.length) }, () =>
    worker()
  );
  await Promise.all(workers);

  return results;
}

// ---------------------------------------------------------------------------
// Per-site scan
// ---------------------------------------------------------------------------

async function scanSiteLinks(siteName, siteUrl) {
  console.log(`\n--- Broken Links: ${siteName} (${siteUrl}) ---`);

  const siteHostname = new URL(siteUrl).hostname;
  const result = {
    site: siteName,
    siteUrl,
    homepageLinks: [],
    sitemapLinks: [],
    brokenLinks: [],
    totalChecked: 0,
    totalBroken: 0,
  };

  // ---- Step 1: Fetch homepage and extract links --------------------------
  let homepageHtml;
  try {
    const homeRes = await fetchUrl(siteUrl);
    if (homeRes.status !== 200) {
      console.error(`  ❌ Homepage returned HTTP ${homeRes.status}, skipping`);
      result.error = `Homepage HTTP ${homeRes.status}`;
      return result;
    }
    homepageHtml = homeRes.body;
  } catch (err) {
    console.error(`  ❌ Failed to fetch homepage: ${err.message}`);
    result.error = err.message;
    return result;
  }

  const allHomeLinks = extractLinksFromHtml(homepageHtml, siteUrl);
  const internalHomeLinks = allHomeLinks.filter((link) =>
    isInternalLink(link, siteHostname)
  );
  console.log(`  📄 Homepage: ${allHomeLinks.length} total links, ${internalHomeLinks.length} internal`);

  // ---- Step 2: Fetch sitemap.xml and extract URLs ------------------------
  let sitemapUrls = [];
  try {
    const sitemapUrl = new URL("/sitemap.xml", siteUrl).href;
    const sitemapRes = await fetchUrl(sitemapUrl);
    if (sitemapRes.status === 200) {
      sitemapUrls = extractUrlsFromSitemap(sitemapRes.body, siteUrl);
      console.log(`  🗺️  Sitemap: ${sitemapUrls.length} URLs found`);
    } else {
      console.log(`  ⚠️  Sitemap returned HTTP ${sitemapRes.status}, skipping`);
    }
  } catch (err) {
    console.log(`  ⚠️  Could not fetch sitemap: ${err.message}`);
  }

  // ---- Step 3: Merge and deduplicate ------------------------------------
  const allUrlsToCheck = [...new Set([...internalHomeLinks, ...sitemapUrls])];
  console.log(`  🔗 Total unique URLs to check: ${allUrlsToCheck.length}`);

  if (allUrlsToCheck.length === 0) {
    console.log("  ℹ️  No URLs to check");
    return result;
  }

  // ---- Step 4: Check all links -------------------------------------------
  console.log(`  🚀 Checking links (concurrency: 10)...`);
  const checked = await checkLinks(allUrlsToCheck);

  const broken = checked.filter((c) => c.broken);
  const healthy = checked.filter((c) => !c.broken);

  result.homepageLinks = internalHomeLinks;
  result.sitemapLinks = sitemapUrls;
  result.brokenLinks = broken;
  result.totalChecked = checked.length;
  result.totalBroken = broken.length;
  result.allLinks = checked; // full results for audit trail

  console.log(`  ✅ ${healthy.length} healthy, ❌ ${broken.length} broken`);

  if (broken.length > 0) {
    for (const b of broken) {
      console.log(`    ❌ ${b.url} → ${b.status}${b.error ? ` (${b.error})` : ""}`);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function scanBrokenLinks() {
  console.log("=".repeat(60));
  console.log("Broken Links Scanner — Starting");
  console.log("=".repeat(60));

  const siteUrlGtm = process.env.GSC_SITE_URL_GTM;
  const siteUrlVa = process.env.GSC_SITE_URL_VA;

  if (!siteUrlGtm || !siteUrlVa) {
    console.error("❌ Missing GSC_SITE_URL_GTM or GSC_SITE_URL_VA env vars");
    return;
  }

  const sites = [
    { name: "gotripmate", url: siteUrlGtm },
    { name: "voyageally", url: siteUrlVa },
  ];

  const today = new Date().toISOString().slice(0, 10);
  const siteResults = [];
  let grandTotalChecked = 0;
  let grandTotalBroken = 0;

  for (const site of sites) {
    const siteResult = await scanSiteLinks(site.name, site.url);
    siteResults.push(siteResult);
    grandTotalChecked += siteResult.totalChecked || 0;
    grandTotalBroken += siteResult.totalBroken || 0;
  }

  // ---- Write results -----------------------------------------------------
  const auditPayload = {
    fetchedAt: new Date().toISOString(),
    date: today,
    sites: siteResults.map((s) => ({
      site: s.site,
      siteUrl: s.siteUrl,
      totalChecked: s.totalChecked,
      totalBroken: s.totalBroken,
      brokenLinks: s.brokenLinks,
      error: s.error || null,
    })),
  };

  const brokenFile = path.join(DATA_AUDITS, "broken-links-today.json");
  await writeJson(brokenFile, auditPayload);
  console.log(`\n📁 Wrote ${brokenFile}`);

  // ---- Summary -----------------------------------------------------------
  console.log("\n" + "=".repeat(60));
  console.log("Broken Links Scan Summary");
  console.log("=".repeat(60));
  console.log(`  Sites checked   : ${sites.length}`);
  console.log(`  Total links     : ${grandTotalChecked}`);
  console.log(`  Broken found    : ${grandTotalBroken}`);
  console.log(`  Date            : ${today}`);
  console.log("=".repeat(60));

  return { success: true, totalChecked: grandTotalChecked, totalBroken: grandTotalBroken, date: today };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  scanBrokenLinks().catch((err) => {
    console.error("Unhandled error in broken-links scan:", err);
    process.exit(1);
  });
}
