// =============================================================================
// Technical SEO Scanner
// =============================================================================
// Runs on-page technical SEO checks against both sites: HTTP status, page load
// time, robots.txt, sitemap.xml, meta tags (title, description, canonical,
// og:title, JSON-LD, H1), and SSL certificate validity.
// Part of the Daily SEO Auto-Optimization Loop.
// =============================================================================

import { promises as fs } from "node:fs";
import https from "node:https";
import http from "node:http";
import tls from "node:tls";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
 * Perform an HTTP / HTTPS GET and return the response body, status code, and
 * timing info.  Accepts an optional `protocol` override (defaults to https).
 */
function fetchUrl(urlString, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(urlString);
    const mod = urlObj.protocol === "http:" ? http : https;

    const start = Date.now();
    const req = mod.get(
      urlString,
      { timeout, rejectUnauthorized: false },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const elapsed = Date.now() - start;
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString("utf-8"),
            elapsed,
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
 * Perform a simple HEAD request and return status + timing.
 */
function headUrl(urlString, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(urlString);
    const mod = urlObj.protocol === "http:" ? http : https;

    const start = Date.now();
    const req = mod.request(
      urlString,
      { method: "HEAD", timeout, rejectUnauthorized: false },
      (res) => {
        const elapsed = Date.now() - start;
        // Consume the response to free memory
        res.resume();
        resolve({ status: res.statusCode, elapsed, headers: res.headers });
      }
    );

    req.on("error", (err) => reject(err));
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`HEAD timed out after ${timeout}ms`));
    });
    req.end();
  });
}

/**
 * Check the SSL certificate for a given hostname.  Returns expiry info.
 */
function checkSsl(hostname, port = 443) {
  return new Promise((resolve) => {
    const socket = tls.connect(
      port,
      hostname,
      { rejectUnauthorized: false, servername: hostname },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();

        if (!cert || Object.keys(cert).length === 0) {
          resolve({
            valid: false,
            reason: "No certificate returned",
            expiresAt: null,
            daysRemaining: 0,
          });
          return;
        }

        const expiresAt = new Date(cert.valid_to);
        const now = new Date();
        const daysRemaining = Math.floor(
          (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        );

        resolve({
          valid: daysRemaining > 0,
          subject: cert.subject ? cert.subject.CN : null,
          issuer: cert.issuer ? cert.issuer.O : null,
          validFrom: cert.valid_from,
          validTo: cert.valid_to,
          expiresAt: expiresAt.toISOString(),
          daysRemaining,
          expiringSoon: daysRemaining <= 30,
        });
      }
    );

    socket.on("error", (err) => {
      resolve({
        valid: false,
        reason: err.message,
        expiresAt: null,
        daysRemaining: 0,
      });
    });

    socket.setTimeout(10000, () => {
      socket.destroy();
      resolve({
        valid: false,
        reason: "SSL check timed out",
        expiresAt: null,
        daysRemaining: 0,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

/**
 * Check homepage HTTP status and page load time.
 */
async function checkHttpStatus(siteUrl) {
  const result = {
    url: siteUrl,
    status: null,
    loadTimeMs: null,
    passed: false,
  };

  try {
    const res = await fetchUrl(siteUrl);
    result.status = res.status;
    result.loadTimeMs = res.elapsed;
    result.passed = res.status === 200;
  } catch (err) {
    result.error = err.message;
  }

  return result;
}

/**
 * Check robots.txt: accessible and contains Sitemap directive.
 */
async function checkRobotsTxt(siteUrl) {
  const robotsUrl = new URL("/robots.txt", siteUrl).href;
  const result = {
    url: robotsUrl,
    accessible: false,
    hasSitemapDirective: false,
    passed: false,
  };

  try {
    const res = await fetchUrl(robotsUrl);
    result.accessible = res.status === 200;
    if (res.status === 200) {
      result.hasSitemapDirective =
        res.body.toLowerCase().includes("sitemap:");
      result.passed = result.accessible && result.hasSitemapDirective;
    }
  } catch (err) {
    result.error = err.message;
  }

  return result;
}

/**
 * Check sitemap.xml: accessible and valid XML.
 */
async function checkSitemapXml(siteUrl) {
  const sitemapUrl = new URL("/sitemap.xml", siteUrl).href;
  const result = {
    url: sitemapUrl,
    accessible: false,
    validXml: false,
    passed: false,
  };

  try {
    const res = await fetchUrl(sitemapUrl);
    result.accessible = res.status === 200;
    if (res.status === 200) {
      // Simple XML validity check — must start with <?xml or <
      const trimmed = res.body.trim();
      result.validXml = trimmed.startsWith("<?xml") || trimmed.startsWith("<");
      result.passed = result.accessible && result.validXml;
    }
  } catch (err) {
    result.error = err.message;
  }

  return result;
}

/**
 * Parse meta tags from the homepage HTML and validate them.
 */
async function checkMetaTags(siteUrl) {
  const result = {
    url: siteUrl,
    title: { exists: false, empty: false, length: null, validLength: false, value: null },
    metaDescription: { exists: false, empty: false, length: null, validLength: false, value: null },
    canonical: { exists: false, value: null },
    ogTitle: { exists: false, value: null },
    jsonLd: { exists: false, count: 0 },
    h1: { exists: false, count: 0, exactlyOne: false },
    passed: false,
  };

  try {
    const res = await fetchUrl(siteUrl);
    if (res.status !== 200) {
      result.error = `HTTP ${res.status}`;
      return result;
    }

    const html = res.body;

    // --- Title tag ---
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) {
      const value = titleMatch[1].trim();
      result.title.exists = true;
      result.title.empty = value.length === 0;
      result.title.length = value.length;
      result.title.validLength = value.length >= 50 && value.length <= 60;
      result.title.value = value;
    }

    // --- Meta description ---
    const descMatch = html.match(
      /<meta\s+[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["'][^>]*\/?>/i
    );
    if (descMatch) {
      const value = descMatch[1].trim();
      result.metaDescription.exists = true;
      result.metaDescription.empty = value.length === 0;
      result.metaDescription.length = value.length;
      result.metaDescription.validLength =
        value.length >= 150 && value.length <= 160;
      result.metaDescription.value = value;
    }

    // --- Canonical link ---
    const canonicalMatch = html.match(
      /<link[^>]*rel=["']canonical["'][^>]*href=["']([\s\S]*?)["'][^>]*\/?>/i
    );
    if (canonicalMatch) {
      result.canonical.exists = true;
      result.canonical.value = canonicalMatch[1].trim();
    }

    // --- OG:title ---
    const ogTitleMatch = html.match(
      /<meta[^>]*property=["']og:title["'][^>]*content=["']([\s\S]*?)["'][^>]*\/?>/i
    );
    if (ogTitleMatch) {
      result.ogTitle.exists = true;
      result.ogTitle.value = ogTitleMatch[1].trim();
    }

    // --- JSON-LD ---
    const jsonLdMatches = html.match(
      /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    );
    if (jsonLdMatches) {
      result.jsonLd.exists = true;
      result.jsonLd.count = jsonLdMatches.length;
    }

    // --- H1 tag ---
    const h1Matches = html.match(/<h1[^>]*>[\s\S]*?<\/h1>/gi);
    if (h1Matches) {
      result.h1.exists = true;
      result.h1.count = h1Matches.length;
      result.h1.exactlyOne = h1Matches.length === 1;
    }

    // Overall pass if all critical tags exist and meet requirements
    const criticalPass =
      result.title.exists &&
      !result.title.empty &&
      result.metaDescription.exists &&
      !result.metaDescription.empty &&
      result.canonical.exists &&
      result.ogTitle.exists &&
      result.jsonLd.exists &&
      result.h1.exactlyOne;

    result.passed = criticalPass;
  } catch (err) {
    result.error = err.message;
  }

  return result;
}

/**
 * Check SSL certificate validity and expiration.
 */
async function checkSslCert(siteUrl) {
  const hostname = new URL(siteUrl).hostname;
  const result = {
    hostname,
    valid: false,
    daysRemaining: 0,
    expiringSoon: false,
    passed: false,
  };

  try {
    const sslInfo = await checkSsl(hostname);
    result.valid = sslInfo.valid;
    result.daysRemaining = sslInfo.daysRemaining;
    result.expiringSoon = sslInfo.expiringSoon;
    result.issuer = sslInfo.issuer;
    result.validFrom = sslInfo.validFrom;
    result.validTo = sslInfo.validTo;
    result.passed = sslInfo.valid && !sslInfo.expiringSoon;
  } catch (err) {
    result.error = err.message;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Run all checks for a single site
// ---------------------------------------------------------------------------

async function runTechnicalChecks(siteName, siteUrl) {
  console.log(`\n--- Technical Audit: ${siteName} (${siteUrl}) ---`);

  const checks = {
    httpStatus: null,
    robotsTxt: null,
    sitemapXml: null,
    metaTags: null,
    sslCert: null,
  };

  // Run independent checks in parallel
  const [httpStatus, robotsTxt, sitemapXml, metaTags, sslCert] =
    await Promise.all([
      checkHttpStatus(siteUrl),
      checkRobotsTxt(siteUrl),
      checkSitemapXml(siteUrl),
      checkMetaTags(siteUrl),
      checkSslCert(siteUrl),
    ]);

  checks.httpStatus = httpStatus;
  checks.robotsTxt = robotsTxt;
  checks.sitemapXml = sitemapXml;
  checks.metaTags = metaTags;
  checks.sslCert = sslCert;

  // Log each check result
  console.log(
    `  HTTP Status     : ${httpStatus.passed ? "✅" : "❌"} ${httpStatus.status} (${httpStatus.loadTimeMs}ms)`
  );
  console.log(
    `  robots.txt      : ${robotsTxt.passed ? "✅" : "❌"} ${robotsTxt.accessible ? "accessible" : "unreachable"}${robotsTxt.hasSitemapDirective ? ", has Sitemap directive" : ""}`
  );
  console.log(
    `  sitemap.xml     : ${sitemapXml.passed ? "✅" : "❌"} ${sitemapXml.accessible ? (sitemapXml.validXml ? "valid XML" : "invalid XML") : "unreachable"}`
  );
  console.log(
    `  Title tag       : ${metaTags.title.exists ? "✅" : "❌"} ${metaTags.title.exists ? `(${metaTags.title.length} chars${metaTags.title.validLength ? ", OK" : ", outside 50-60"})` : "missing"}`
  );
  console.log(
    `  Meta desc       : ${metaTags.metaDescription.exists ? "✅" : "❌"} ${metaTags.metaDescription.exists ? `(${metaTags.metaDescription.length} chars${metaTags.metaDescription.validLength ? ", OK" : ", outside 150-160"})` : "missing"}`
  );
  console.log(
    `  Canonical       : ${metaTags.canonical.exists ? "✅" : "❌"}`
  );
  console.log(
    `  OG:title        : ${metaTags.ogTitle.exists ? "✅" : "❌"}`
  );
  console.log(
    `  JSON-LD         : ${metaTags.jsonLd.exists ? "✅" : "❌"} (${metaTags.jsonLd.count} blocks)`
  );
  console.log(
    `  H1 tag          : ${metaTags.h1.exactlyOne ? "✅" : "❌"} (${metaTags.h1.count} found)`
  );
  console.log(
    `  SSL cert        : ${sslCert.passed ? "✅" : "❌"} ${sslCert.valid ? `(${sslCert.daysRemaining} days remaining)` : "invalid"}`
  );

  return checks;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function scanTechnical() {
  console.log("=".repeat(60));
  console.log("Technical SEO Scanner — Starting");
  console.log("=".repeat(60));

  const siteUrlGtm = (process.env.GSC_SITE_URL_GTM || '').replace(/^sc_domain:/, '').replace(/^sc_prefix:/, '');
  const siteUrlVa = (process.env.GSC_SITE_URL_VA || '').replace(/^sc_domain:/, '').replace(/^sc_prefix:/, '');

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
  let totalPassed = 0;
  let totalFailed = 0;
  let totalChecks = 0;

  for (const site of sites) {
    const checks = await runTechnicalChecks(site.name, site.url);

    // Count pass/fail across the 5 top-level checks
    const checkKeys = ["httpStatus", "robotsTxt", "sitemapXml", "metaTags", "sslCert"];
    let passed = 0;
    let failed = 0;
    for (const key of checkKeys) {
      if (checks[key]) {
        if (checks[key].passed) {
          passed++;
        } else {
          failed++;
        }
      }
    }
    totalPassed += passed;
    totalFailed += failed;
    totalChecks += checkKeys.length;

    siteResults.push({
      site: site.name,
      siteUrl: site.url,
      checks,
      summary: { passed, failed, total: checkKeys.length },
    });
  }

  // ---- Write audit file --------------------------------------------------
  const auditPayload = {
    fetchedAt: new Date().toISOString(),
    date: today,
    sites: siteResults,
  };

  const auditFile = path.join(DATA_AUDITS, "audit-today.json");
  await writeJson(auditFile, auditPayload);
  console.log(`\n📁 Wrote ${auditFile}`);

  // ---- Summary -----------------------------------------------------------
  console.log("\n" + "=".repeat(60));
  console.log("Technical Scan Summary");
  console.log("=".repeat(60));
  console.log(`  Sites checked  : ${sites.length}`);
  console.log(`  Total checks   : ${totalChecks}`);
  console.log(`  Passed         : ${totalPassed}`);
  console.log(`  Failed         : ${totalFailed}`);
  console.log(`  Date           : ${today}`);
  console.log("=".repeat(60));

  return { success: true, totalPassed, totalFailed, date: today };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  scanTechnical().catch((err) => {
    console.error("Unhandled error in technical scan:", err);
    process.exit(1);
  });
}
