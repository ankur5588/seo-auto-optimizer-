// =============================================================================
// Meta Rewriter — Auto-generates improved meta titles & descriptions
// =============================================================================
// Reads optimisation targets from data/analysis/optimization-targets.json,
// loads the actual HTML pages from ../gotripmate-site/, rewrites under-performing
// meta tags using rule-based templates (no AI API), validates lengths, and
// logs all changes to data/changes/meta-changes-today.json.
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
// Quality scoring helpers
// ---------------------------------------------------------------------------

/**
 * Score a meta title for SEO quality.
 * Perfect is 50-60 chars. Returns 0-100.
 */
function scoreTitle(title) {
  if (!title) return 0;
  const len = title.length;
  let score = 0;

  // Length scoring
  if (len >= 50 && len <= 60) score += 40;
  else if (len >= 40 && len <= 70) score += 25;
  else if (len >= 30 && len <= 80) score += 15;
  else score += 5;

  // Contains primary keyword indicator (brand name is good)
  if (/GoTripMate|VoyageAlly/i.test(title)) score += 15;

  // Contains a pipe separator (good practice)
  if (/\|/.test(title)) score += 10;

  // Contains a power word
  if (/\b(Best|Ultimate|Top|Guide|Essential|Complete|Expert|Proven|2026)\b/i.test(title)) score += 15;

  // Not too short, not keyword-stuffed
  const wordCount = title.split(/\s+/).length;
  if (wordCount >= 5 && wordCount <= 12) score += 10;

  // Starts with a strong keyword (not generic)
  if (/^(Best|Top|Ultimate|How|Why|The\s+(Ultimate|Complete|Essential|Best))|^\d+/i.test(title)) score += 10;

  return Math.min(score, 100);
}

/**
 * Score a meta description for SEO quality.
 * Perfect is 150-160 chars. Returns 0-100.
 */
function scoreDescription(desc) {
  if (!desc) return 0;
  const len = desc.length;
  let score = 0;

  // Length scoring
  if (len >= 150 && len <= 160) score += 35;
  else if (len >= 140 && len <= 170) score += 25;
  else if (len >= 120 && len <= 180) score += 15;
  else score += 5;

  // Contains a call-to-action
  if (/\b(learn|discover|find|explore|start|try|get|download|join|see how)\b/i.test(desc)) score += 15;

  // Contains a benefit or value prop
  if (/\b(save|easy|best|free|guide|tips|safety|budget|plan|track|perfect)\b/i.test(desc)) score += 15;

  // Contains target keyword (common patterns)
  if (/travel|buddy|trip|companion|expense|solo|safety|plan/i.test(desc)) score += 10;

  // Natural language (not keyword-stuffed) — check reading flow
  if (len > 100 && !/,\s*,/.test(desc)) score += 15;

  // Has a clear value proposition early
  const first110 = desc.slice(0, 110);
  if (first110.length >= 80 && /[.!?]/.test(first110)) score += 10;

  return Math.min(score, 100);
}

// ---------------------------------------------------------------------------
// Title and description generators
// ---------------------------------------------------------------------------

/**
 * Determine page type from path and content.
 */
function detectPageType(filePath, $) {
  const lower = filePath.toLowerCase();

  if (lower.includes("index") || lower === path.join(SITE_DIR, "index.html")) {
    return "homepage";
  }
  if (lower.includes("blog") || $("article").length > 0 || $(".blog-post").length > 0) {
    return "blog";
  }
  if (lower.includes("feature") || lower.includes("pricing") || lower.includes("about")) {
    return "feature";
  }
  // Check for typical page sections
  if ($(".hero").length > 0 && $(".features-grid").length > 0) {
    return "homepage";
  }
  return "feature";
}

/**
 * Extract a primary topic from the page content.
 */
function extractPageTopic($) {
  // Try h1 first
  const h1 = $("h1").first().text().trim();
  if (h1 && h1.length > 10 && h1.length < 100) return h1;

  // Try the title
  const title = $("title").text().trim();
  if (title) {
    // Remove brand suffix
    return title.replace(/\s*[—–|-]\s*(GoTripMate|VoyageAlly).*$/i, "").trim();
  }

  // Fall back to meta keywords
  const keywords = $('meta[name="keywords"]').attr("content");
  if (keywords) {
    return keywords.split(",")[0].trim();
  }

  return "";
}

/**
 * Generate an improved meta title based on page type and content.
 */
function generateImprovedTitle(filePath, $) {
  const pageType = detectPageType(filePath, $);
  const topic = extractPageTopic($);
  const currentTitle = $("title").text().trim();

  // Check if it's a GoTripMate or VoyageAlly page
  const isGTM = filePath.toLowerCase().includes("gotripmate") || currentTitle.includes("GoTripMate");
  const isVA = filePath.toLowerCase().includes("voyageally") || currentTitle.includes("VoyageAlly");
  const brand = isVA ? "VoyageAlly" : "GoTripMate";

  let newTitle = "";

  switch (pageType) {
    case "homepage": {
      // Homepage formula: [Brand Tagline] | [Brand Name]
      if (isVA) {
        newTitle = "Travel Smarter with Expense Tracking & Offline Maps | VoyageAlly";
      } else {
        newTitle = "Plan Trips & Find Travel Buddies | GoTripMate";
      }
      break;
    }

    case "blog": {
      // Blog formula: [Keyword-Rich Title] | [Brand] Blog
      const cleanTopic = topic || "Travel Tips";
      const shortTopic = cleanTopic.length > 45 ? cleanTopic.slice(0, 42) + "..." : cleanTopic;
      newTitle = `${shortTopic} | ${brand} Blog`;
      break;
    }

    case "feature": {
      // Feature formula: [Feature Name] - [Benefit] | [Brand]
      if (isVA) {
        newTitle = "Expense Tracking & Offline Maps - Travel Smarter | VoyageAlly";
      } else {
        newTitle = "Travel Buddy Matching - Find Your Perfect Companion | GoTripMate";
      }
      break;
    }

    default: {
      newTitle = `${topic || "Travel Tools"} | ${brand}`;
      break;
    }
  }

  // Ensure it's within 50-60 chars; trim if too long
  if (newTitle.length > 60) {
    newTitle = newTitle.slice(0, 57) + "...";
  }

  return newTitle;
}

/**
 * Generate an improved meta description based on page content.
 */
function generateImprovedDescription(filePath, $) {
  const pageType = detectPageType(filePath, $);
  const topic = extractPageTopic($);
  const currentDesc = $('meta[name="description"]').attr("content") || "";

  const isVA = filePath.toLowerCase().includes("voyageally") || currentDesc.includes("VoyageAlly");
  const brand = isVA ? "VoyageAlly" : "GoTripMate";

  let desc = "";

  switch (pageType) {
    case "homepage": {
      if (isVA) {
        desc = "Track expenses, navigate offline, and stay safe with VoyageAlly - your all-in-one travel companion. Download free and explore smarter today.";
      } else {
        desc = "Find your perfect travel buddy or group with GoTripMate. Match with travelers who share your destination, dates, and interests. Join free today.";
      }
      break;
    }

    case "blog": {
      const cleanTopic = topic || "travel tips";
      const shortTopic = cleanTopic.length > 60 ? cleanTopic.slice(0, 57) + "..." : cleanTopic;

      if (isVA) {
        desc = `Discover essential ${shortTopic.toLowerCase()} with VoyageAlly. Learn expert tips, compare top tools, and make your next adventure safer and smarter.`;
      } else {
        desc = `Looking for ${shortTopic.toLowerCase()}? Our comprehensive guide covers everything you need to know. Expert tips, top recommendations, and practical advice inside.`;
      }
      break;
    }

    case "feature": {
      if (isVA) {
        desc = "Discover VoyageAlly's powerful features: multi-currency expense tracking, offline maps, safety alerts, and AI packing lists. Plan smarter, travel better.";
      } else {
        desc = "GoTripMate makes finding travel buddies easy. Smart matching, verified profiles, in-app chat, and itinerary planning - all in one platform. Get started free.";
      }
      break;
    }

    default: {
      desc = `Explore ${topic || "travel tools and resources"} with ${brand}. Find tips, guides, and everything you need for your next adventure. Start planning today.`;
      break;
    }
  }

  // Ensure length is 150-160 chars
  if (desc.length > 160) {
    desc = desc.slice(0, 157) + "...";
  } else if (desc.length < 150) {
    // Pad with a CTA if too short
    const cta = isVA
      ? " Download VoyageAlly and travel smarter."
      : " Join GoTripMate and find your travel buddy today.";
    const needed = 150 - desc.length;
    if (needed > 0 && needed < cta.length) {
      desc += cta.slice(0, needed);
    } else if (needed >= cta.length) {
      desc += cta;
    }
  }

  return desc;
}

/**
 * Determine if an improvement is significant (>10% better score).
 */
function isSignificantImprovement(current, proposed) {
  const currentScore = typeof current === "string"
    ? scoreTitle(current)
    : scoreDescription(current);
  const proposedScore = typeof proposed === "string"
    ? scoreTitle(proposed)
    : scoreDescription(proposed);

  // If current is already good (>=75), don't rewrite
  if (currentScore >= 75) return false;

  // Need >10% improvement or at least 10 points gain
  const improvement = proposedScore - currentScore;
  return improvement > 10;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function rewriteMeta() {
  console.log("=".repeat(60));
  console.log("META REWRITER — Starting");
  console.log("=".repeat(60));

  // ---- Read optimisation targets ------------------------------------------
  const targetsPath = path.join(ANALYSIS_DIR, "optimization-targets.json");
  const targets = await readJson(targetsPath, []);
  const targetsArr = Array.isArray(targets) ? targets : (targets.targets || []);

  if (!targetsArr.length) {
    console.log("No optimisation targets found. Skipping meta rewrites.");
    console.log("\n=== META REWRITES ===");
    console.log("Pages updated: 0");
    console.log("Titles rewritten: 0");
    console.log("Descriptions rewritten: 0");
    console.log("Skipped (no improvement found): 0");
    return { pagesUpdated: 0, titlesRewritten: 0, descriptionsRewritten: 0, skipped: 0 };
  }

  // Filter to only 'update-meta' actions
  const metaTargets = targetsArr.filter(
    (t) => t.action === "update-meta" || t.type === "meta"
  );

  if (!metaTargets.length) {
    console.log("No 'update-meta' targets found. Skipping.");
    console.log("\n=== META REWRITES ===");
    console.log("Pages updated: 0");
    console.log("Titles rewritten: 0");
    console.log("Descriptions rewritten: 0");
    console.log("Skipped (no improvement found): 0");
    return { pagesUpdated: 0, titlesRewritten: 0, descriptionsRewritten: 0, skipped: 0 };
  }

  console.log(`Found ${metaTargets.length} meta optimisation target(s).`);

  // ---- Process each target ------------------------------------------------
  const changesLog = [];
  let pagesUpdated = 0;
  let titlesRewritten = 0;
  let descriptionsRewritten = 0;
  let skipped = 0;

  for (const target of metaTargets) {
    const pagePath = target.page || target.url || "";
    const relativePath = pagePath.replace(/^(https?:\/\/[^\/]+)/, "");
    let htmlFilePath = "";

    // Map URL paths to actual files in gotripmate-site
    if (relativePath.includes("voyageally") || pagePath.includes("voyageally")) {
      htmlFilePath = path.join(SITE_DIR, "voyageally.html");
    } else {
      htmlFilePath = path.join(SITE_DIR, "index.html");
    }

    console.log(`\n  Target: ${pagePath}`);
    console.log(`  HTML file: ${htmlFilePath}`);

    // ---- Read current HTML ------------------------------------------------
    let html;
    try {
      html = await fs.readFile(htmlFilePath, "utf-8");
    } catch (err) {
      console.error(`  ❌ Cannot read ${htmlFilePath}: ${err.message}`);
      skipped++;
      continue;
    }

    const $ = cheerio.load(html);
    const currentTitle = $("title").text().trim();
    const currentDesc = $('meta[name="description"]').attr("content") || "";

    console.log(`  Current title : "${currentTitle}" (${currentTitle.length} chars, score: ${scoreTitle(currentTitle)})`);
    console.log(`  Current desc  : "${currentDesc.slice(0, 50)}..." (${currentDesc.length} chars, score: ${scoreDescription(currentDesc)})`);

    // ---- Generate improvements -------------------------------------------
    const newTitle = generateImprovedTitle(htmlFilePath, $);
    const newDesc = generateImprovedDescription(htmlFilePath, $);

    let titleChanged = false;
    let descChanged = false;
    let pageChanged = false;

    // ---- Check title improvement -----------------------------------------
    if (newTitle !== currentTitle && isSignificantImprovement(currentTitle, newTitle)) {
      $("title").text(newTitle);
      // Also update og:title and twitter:title
      $('meta[property="og:title"]').attr("content", newTitle);
      $('meta[name="twitter:title"]').attr("content", newTitle);
      titleChanged = true;
      pageChanged = true;
      console.log(`  ✅ Title improved: "${newTitle}" (${newTitle.length} chars, score: ${scoreTitle(newTitle)})`);
    } else if (newTitle !== currentTitle) {
      console.log(`  ⏭️  Title not improved enough. Current score: ${scoreTitle(currentTitle)}, New score: ${scoreTitle(newTitle)}`);
    } else {
      console.log(`  ⏭️  Title unchanged (already matches generated).`);
    }

    // ---- Check description improvement -----------------------------------
    if (newDesc !== currentDesc && isSignificantImprovement(currentDesc, newDesc)) {
      $('meta[name="description"]').attr("content", newDesc);
      $('meta[property="og:description"]').attr("content", newDesc);
      $('meta[name="twitter:description"]').attr("content", newDesc);
      descChanged = true;
      pageChanged = true;
      console.log(`  ✅ Description improved: "${newDesc.slice(0, 60)}..." (${newDesc.length} chars, score: ${scoreDescription(newDesc)})`);
    } else if (newDesc !== currentDesc) {
      console.log(`  ⏭️  Description not improved enough. Current score: ${scoreDescription(currentDesc)}, New score: ${scoreDescription(newDesc)}`);
    } else {
      console.log(`  ⏭️  Description unchanged (already matches generated).`);
    }

    // ---- Apply changes if any ---------------------------------------------
    if (pageChanged) {
      await fs.writeFile(htmlFilePath, $.html(), "utf-8");
      pagesUpdated++;
      if (titleChanged) titlesRewritten++;
      if (descChanged) descriptionsRewritten++;
      console.log(`  💾 Saved changes to ${htmlFilePath}`);
    } else {
      skipped++;
      console.log(`  ⏭️  No changes needed for this page.`);
    }

    // ---- Log the change ---------------------------------------------------
    changesLog.push({
      page: pagePath,
      file: relativePath || htmlFilePath,
      timestamp: new Date().toISOString(),
      title: {
        before: currentTitle,
        after: titleChanged ? newTitle : currentTitle,
        changed: titleChanged,
        beforeScore: scoreTitle(currentTitle),
        afterScore: titleChanged ? scoreTitle(newTitle) : scoreTitle(currentTitle),
      },
      description: {
        before: currentDesc,
        after: descChanged ? newDesc : currentDesc,
        changed: descChanged,
        beforeScore: scoreDescription(currentDesc),
        afterScore: descChanged ? scoreDescription(newDesc) : scoreDescription(currentDesc),
      },
    });
  }

  // ---- Save change log ----------------------------------------------------
  const logPath = path.join(CHANGES_DIR, "meta-changes-today.json");
  const logData = {
    date: new Date().toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
    summary: {
      pagesUpdated,
      titlesRewritten,
      descriptionsRewritten,
      skipped,
    },
    changes: changesLog,
  };
  await writeJson(logPath, logData);
  console.log(`\n📁 Change log saved: ${logPath}`);

  // ---- Summary ------------------------------------------------------------
  console.log("\n=== META REWRITES ===");
  console.log(`Pages updated: ${pagesUpdated}`);
  console.log(`Titles rewritten: ${titlesRewritten}`);
  console.log(`Descriptions rewritten: ${descriptionsRewritten}`);
  console.log(`Skipped (no improvement found): ${skipped}`);
  console.log("=".repeat(60));

  return { pagesUpdated, titlesRewritten, descriptionsRewritten, skipped };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  rewriteMeta().catch((err) => {
    console.error("Unhandled error in meta rewriter:", err);
    process.exit(1);
  });
}
