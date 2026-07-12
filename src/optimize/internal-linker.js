// =============================================================================
// Internal Linker — Suggests & adds internal links between related pages
// =============================================================================
// Reads content gap analysis from data/analysis/optimization-targets.json,
// reads blog post metadata from ../marketing-dashboard/src/lib/content/,
// reads HTML files from ../gotripmate-site/, and adds contextual internal
// links based on rule-based keyword matching. Logs all changes to
// data/changes/links-added-today.json.
// =============================================================================

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const SITE_DIR = path.resolve(PROJECT_ROOT, "..", "gotripmate-site");
const CONTENT_DIR = path.resolve(PROJECT_ROOT, "..", "marketing-dashboard", "src", "lib", "content");
const DATA_DIR = path.join(PROJECT_ROOT, "data");
const ANALYSIS_DIR = path.join(DATA_DIR, "analysis");
const CHANGES_DIR = path.join(DATA_DIR, "changes");

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
// Internal link rules
// ---------------------------------------------------------------------------

const LINK_RULES = [
  {
    keywords: ["buddy", "companion", "travel buddy", "travel companion", "travel partner", "buddy matching", "find a buddy", "meet travelers"],
    targetUrl: "/blog/find-travel-buddies-guide",
    anchorSuggestion: "finding travel buddies",
    brands: ["gotripmate", "both"],
  },
  {
    keywords: ["expense", "budget", "tracking", "spending", "cost", "money", "financial", "expense tracker", "budgeting", "travel budget", "save money"],
    targetUrl: "/blog/travel-expense-tracker-guide",
    anchorSuggestion: "travel expense tracking",
    brands: ["voyageally", "both"],
  },
  {
    keywords: ["safety", "safe", "secure", "emergency", "protect", "danger", "risk", "scam", "security", "safety app", "stay safe", "travel safety"],
    targetUrl: "/blog/travel-safety-apps-guide",
    anchorSuggestion: "travel safety tips",
    brands: ["voyageally", "gotripmate", "both"],
  },
  {
    keywords: ["packing", "pack", "luggage", "suitcase", "what to bring", "packing list", "packing tips", "travel gear", "essentials"],
    targetUrl: "/blog/ultimate-packing-list-guide",
    anchorSuggestion: "ultimate packing list",
    brands: ["both"],
  },
  {
    keywords: ["plan", "itinerary", "trip planning", "planning", "schedule", "day plan", "route", "organize", "trip plan", "plan a trip", "itinerary planning"],
    targetUrl: "/blog/ultimate-trip-planner-guide",
    anchorSuggestion: "trip planning guide",
    brands: ["gotripmate", "both"],
  },
];

/**
 * Cross-brand linking rules:
 * - GoTripMate pages should link to VoyageAlly for budget/safety mentions
 * - VoyageAlly pages should link to GoTripMate for trip planning/buddy mentions
 */
const CROSS_BRAND_RULES = [
  {
    fromBrand: "gotripmate",
    toBrand: "voyageally",
    keywords: ["budget", "expense", "tracking", "safety", "safe", "emergency", "money", "cost", "financial"],
    targetUrl: "https://voyageally.com",
    anchorSuggestion: "VoyageAlly travel companion app",
    rel: "nofollow",
  },
  {
    fromBrand: "voyageally",
    toBrand: "gotripmate",
    keywords: ["trip planning", "plan a trip", "travel buddy", "companion", "itinerary planning", "buddy", "find travelers", "meet people", "travel partner"],
    targetUrl: "https://gotripmate.com",
    anchorSuggestion: "GoTripMate travel buddy platform",
    rel: "nofollow",
  },
];

// ---------------------------------------------------------------------------
// Content reading helpers
// ---------------------------------------------------------------------------

/**
 * Read blog post data from the marketing dashboard content files.
 * We parse the TypeScript files to extract blog post slugs and keywords.
 */
async function readBlogPosts() {
  const posts = [];

  const brands = ["gotripmate", "voyageally"];
  for (const brand of brands) {
    const blogPath = path.join(CONTENT_DIR, brand, "blog.ts");
    try {
      const content = await fs.readFile(blogPath, "utf-8");

      // Extract blog post objects using simple regex parsing
      // We look for slug and targetKeyword fields
      const slugMatches = content.matchAll(/slug:\s*['"]([^'"]+)['"]/g);
      const keywordMatches = content.matchAll(/targetKeyword:\s*['"]([^'"]+)['"]/g);
      const titleMatches = content.matchAll(/title:\s*['"]([^'"]+)['"]/g);

      const slugs = [...slugMatches].map((m) => m[1]);
      const keywords = [...keywordMatches].map((m) => m[1]);
      const titles = [...titleMatches].map((m) => m[1]);

      for (let i = 0; i < slugs.length; i++) {
        posts.push({
          brand,
          slug: slugs[i] || "",
          keyword: keywords[i] || "",
          title: titles[i] || "",
        });
      }
    } catch (err) {
      console.warn(`  ⚠️  Could not read blog data for ${brand}: ${err.message}`);
    }
  }

  return posts;
}

// ---------------------------------------------------------------------------
// HTML text extraction (exclude <a>, <script>, <style>)
// ---------------------------------------------------------------------------

/**
 * Get text nodes from the body, excluding existing links and scripts.
 * Returns array of { text, element } for elements that contain matching keywords.
 */
function findTextNodes($, container) {
  const nodes = [];

  // Walk text nodes in paragraph, list item, heading, div, and span elements
  const selectors = "p, li, h1, h2, h3, h4, h5, h6, div, span, td, th, blockquote, figcaption";
  $(container).find(selectors).each((_i, el) => {
    const $el = $(el);
    // Skip elements that already contain links
    if ($el.find("a").length > 0) return;
    // Skip script, style, nav, footer
    if ($el.parents("nav, footer, script, style, head").length > 0) return;
    // Skip very short elements
    const text = $el.text().trim();
    if (text.length < 15) return;

    nodes.push({ text, element: el });
  });

  return nodes;
}

/**
 * Check if a text matches any keywords from a rule.
 * Returns the matched keyword or null.
 */
function matchKeyword(text, keywords) {
  const lower = text.toLowerCase();
  for (const kw of keywords) {
    if (lower.includes(kw.toLowerCase())) {
      return kw;
    }
  }
  return null;
}

/**
 * Find the best position in text to insert a link around a matched keyword.
 * Returns { beforeMatch, match, afterMatch } or null.
 */
function findBestAnchorPosition(text, matchedKeyword, suggestedAnchor) {
  const lower = text.toLowerCase();
  const kwLower = matchedKeyword.toLowerCase();
  const idx = lower.indexOf(kwLower);

  if (idx === -1) {
    // Try the suggested anchor instead
    const anchorLower = suggestedAnchor.toLowerCase();
    const anchorIdx = lower.indexOf(anchorLower);
    if (anchorIdx === -1) return null;

    return {
      beforeMatch: text.slice(0, anchorIdx),
      match: text.slice(anchorIdx, anchorIdx + suggestedAnchor.length),
      afterMatch: text.slice(anchorIdx + suggestedAnchor.length),
    };
  }

  // Try to find a good anchor phrase (slightly longer than just the keyword)
  const endIdx = idx + matchedKeyword.length;

  // Look for surrounding context - try to get a natural phrase
  const beforePeriod = text.lastIndexOf(".", idx);
  const afterPeriod = text.indexOf(".", endIdx);
  const sentenceStart = beforePeriod === -1 ? 0 : beforePeriod + 2;
  const sentenceEnd = afterPeriod === -1 ? text.length : afterPeriod;

  // Use the keyword itself as the anchor
  return {
    beforeMatch: text.slice(0, idx),
    match: text.slice(idx, endIdx),
    afterMatch: text.slice(endIdx),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function addInternalLinks() {
  console.log("=".repeat(60));
  console.log("INTERNAL LINKER — Starting");
  console.log("=".repeat(60));

  // ---- Read optimisation targets ------------------------------------------
  const targetsPath = path.join(ANALYSIS_DIR, "optimization-targets.json");
  const targets = await readJson(targetsPath, []);
  const targetsArr = Array.isArray(targets) ? targets : (targets.targets || []);
  console.log(`Loaded ${targetsArr.length} optimisation targets.`);

  // ---- Read blog posts from marketing dashboard ---------------------------
  const blogPosts = await readBlogPosts();
  console.log(`Loaded ${blogPosts.length} blog posts from content library.`);

  // ---- Read HTML files ----------------------------------------------------
  const htmlFiles = [
    { name: "index.html", brand: "gotripmate", filePath: path.join(SITE_DIR, "index.html") },
    { name: "voyageally.html", brand: "voyageally", filePath: path.join(SITE_DIR, "voyageally.html") },
  ];

  const allChanges = [];
  let totalLinksAdded = 0;
  let pagesModified = 0;
  let crossBrandLinks = 0;

  for (const htmlFile of htmlFiles) {
    console.log(`\n--- Processing: ${htmlFile.name} (${htmlFile.brand}) ---`);

    let html;
    try {
      html = await fs.readFile(htmlFile.filePath, "utf-8");
    } catch (err) {
      console.error(`  ❌ Cannot read ${htmlFile.filePath}: ${err.message}`);
      continue;
    }

    const $ = cheerio.load(html);
    const body = $("body");
    if (!body.length) {
      console.error(`  ❌ No <body> found in ${htmlFile.name}`);
      continue;
    }

    const pageChanges = [];
    let linksAddedOnPage = 0;

    // Find text nodes that can be linked
    const textNodes = findTextNodes($, body);
    // Track which keywords have been used to avoid duplicate links
    const usedKeywords = new Set();

    // --- Apply cross-brand rules first ---
    for (const rule of CROSS_BRAND_RULES) {
      if (rule.fromBrand !== htmlFile.brand) continue;

      for (const node of textNodes) {
        const matchedKeyword = matchKeyword(node.text, rule.keywords);
        if (!matchedKeyword) continue;
        if (usedKeywords.has(matchedKeyword.toLowerCase())) continue;

        const $el = $(node.element);
        const text = $el.text().trim();
        const position = findBestAnchorPosition(text, matchedKeyword, rule.anchorSuggestion);
        if (!position) continue;

        // Insert the link, preserving remaining text
        const linkedHtml = `${position.beforeMatch}<a href="${rule.targetUrl}" rel="${rule.rel}">${position.match}</a>${position.afterMatch}`;
        $el.html(linkedHtml);
        usedKeywords.add(matchedKeyword.toLowerCase());
        linksAddedOnPage++;
        crossBrandLinks++;

        pageChanges.push({
          type: "cross-brand",
          anchor: position.match,
          targetUrl: rule.targetUrl,
          rel: rule.rel,
          element: node.element.tagName || "unknown",
          context: text.slice(0, 80) + (text.length > 80 ? "..." : ""),
        });

        console.log(`  🔗 Cross-brand link added: "${position.match}" → ${rule.targetUrl}`);
        break; // One cross-brand link per rule per page
      }
    }

    // --- Apply internal link rules ---
    for (const rule of LINK_RULES) {
      // Check if rule applies to this brand
      const brandMatch = rule.brands.includes("both") || rule.brands.includes(htmlFile.brand);
      if (!brandMatch) continue;

      for (const node of textNodes) {
        const matchedKeyword = matchKeyword(node.text, rule.keywords);
        if (!matchedKeyword) continue;
        if (usedKeywords.has(matchedKeyword.toLowerCase())) continue;

        const $el = $(node.element);
        const text = $el.text().trim();
        const position = findBestAnchorPosition(text, matchedKeyword, rule.anchorSuggestion);
        if (!position) continue;

        // Determine rel - nofollow for cross-brand, none for same-brand
        const rel = htmlFile.brand !== "both" ? "" : "";

        // Determine full URL - if starts with /blog, link to gotripmate.com blog by default
        let fullUrl = rule.targetUrl;
        if (rule.targetUrl.startsWith("/blog")) {
          // Link internally within the same site
          fullUrl = rule.targetUrl;
        }

        const linkedHtml = `${position.beforeMatch}<a href="${fullUrl}">${position.match}</a>${position.afterMatch}`;
        $el.html(linkedHtml);
        usedKeywords.add(matchedKeyword.toLowerCase());
        linksAddedOnPage++;

        pageChanges.push({
          type: "internal",
          anchor: position.match,
          targetUrl: fullUrl,
          element: node.element.tagName || "unknown",
          context: text.slice(0, 80) + (text.length > 80 ? "..." : ""),
        });

        console.log(`  🔗 Internal link added: "${position.match}" → ${fullUrl}`);
        break; // One link per rule per page
      }
    }

    // --- Save changes if any links were added ---
    if (linksAddedOnPage > 0) {
      await fs.writeFile(htmlFile.filePath, $.html(), "utf-8");
      pagesModified++;
      totalLinksAdded += linksAddedOnPage;
      console.log(`  💾 Saved ${linksAddedOnPage} link(s) to ${htmlFile.filePath}`);
    } else {
      console.log(`  ⏭️  No links added to ${htmlFile.name}.`);
    }

    allChanges.push({
      page: htmlFile.name,
      brand: htmlFile.brand,
      file: htmlFile.filePath,
      linksAdded: linksAddedOnPage,
      changes: pageChanges,
    });
  }

  // ---- Save change log ----------------------------------------------------
  const logPath = path.join(CHANGES_DIR, "links-added-today.json");
  const logData = {
    date: new Date().toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
    summary: {
      linksAdded: totalLinksAdded,
      pagesModified,
      crossBrandLinks,
    },
    changes: allChanges,
  };
  await writeJson(logPath, logData);
  console.log(`\n📁 Change log saved: ${logPath}`);

  // ---- Summary ------------------------------------------------------------
  console.log("\n=== INTERNAL LINKS ===");
  console.log(`Links added: ${totalLinksAdded}`);
  console.log(`Pages modified: ${pagesModified}`);
  console.log(`Cross-brand links: ${crossBrandLinks}`);
  console.log("=".repeat(60));

  return { totalLinksAdded, pagesModified, crossBrandLinks };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  addInternalLinks().catch((err) => {
    console.error("Unhandled error in internal linker:", err);
    process.exit(1);
  });
}
