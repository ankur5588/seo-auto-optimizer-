/**
 * content-gap.js — Analyze Module
 *
 * Identifies content optimisation opportunities by cross-referencing
 * today's rankings, the target keyword list, and the technical audit.
 *
 * Part of the Daily SEO Auto-Optimization Loop.
 *
 * Inputs:
 *   data/rankings/rankings-today.json — today's ranking snapshot
 *   data/keywords.json                — target keywords we want to rank for
 *   data/audits/audit-today.json      — technical page audit (optional)
 *
 * Outputs:
 *   data/analysis/content-gap.json         — all gaps found
 *   data/analysis/optimization-targets.json — top 5 prioritised targets
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─────────────────────────────────────────────────────────────
//  Path Constants
// ─────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname   = dirname(__filename);
const ROOT       = join(__dirname, '..', '..');
const DATA_DIR   = join(ROOT, 'data');

const RANKINGS_TODAY_PATH  = join(DATA_DIR, 'rankings', 'rankings-today.json');
const KEYWORDS_PATH        = join(DATA_DIR, 'keywords.json');
const AUDIT_TODAY_PATH     = join(DATA_DIR, 'audits', 'audit-today.json');
const ANALYSIS_DIR         = join(DATA_DIR, 'analysis');
const GAP_OUTPUT_PATH      = join(ANALYSIS_DIR, 'content-gap.json');
const OPTIMISATION_OUTPUT  = join(ANALYSIS_DIR, 'optimization-targets.json');

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Read and parse a JSON file. Returns `null` if missing / broken.
 */
async function readJSON(filePath) {
  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Normalise a ranking entry to a consistent shape.
 */
function normaliseRanking(raw) {
  return {
    keyword:     String(raw.keyword ?? ''),
    position:    Number(raw.position)     || 999,
    clicks:      Number(raw.clicks)       || 0,
    impressions: Number(raw.impressions)  || 0,
    ctr:         Number(raw.ctr)          || 0,
    url:         String(raw.url ?? ''),
  };
}

/**
 * Flatten whatever shape the ranking data comes in to a plain array
 * of normalised entries.
 */
function extractRankings(data) {
  if (!data) return [];

  // { date, rankings: [...] }
  if (!Array.isArray(data) && typeof data === 'object' && Array.isArray(data.rankings)) {
    return data.rankings.map(normaliseRanking);
  }

  // Plain array of entries
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object' && 'keyword' in data[0]) {
    return data.map(normaliseRanking);
  }

  return [];
}

/**
 * Extract a flat list of target keyword strings from keywords.json
 * which could be an array of strings or an array of objects with
 * a `keyword` property.
 */
function extractKeywords(data) {
  if (!data) return [];

  if (Array.isArray(data)) {
    if (data.length === 0) return [];
    if (typeof data[0] === 'string') return data.map(k => k.toLowerCase().trim());
    if (typeof data[0] === 'object' && data[0] !== null) {
      return data
        .filter(item => item.keyword)
        .map(item => String(item.keyword).toLowerCase().trim());
    }
  }

  return [];
}

/**
 * Extract a map of page audits keyed by URL from the audit file.
 */
function extractPageAudits(data) {
  if (!data) return new Map();

  const pages = data.pages || data.page_audits || data;
  if (!Array.isArray(pages)) return new Map();

  const map = new Map();
  for (const p of pages) {
    if (p.url) {
      map.set(p.url, p);
    }
  }
  return map;
}

// ─────────────────────────────────────────────────────────────
//  Gap Detection
// ─────────────────────────────────────────────────────────────

/**
 * Category A: High impressions, low CTR (< 3% with > 500 impressions).
 * These pages need better meta titles / descriptions.
 */
function findLowCTRPages(rankings) {
  return rankings
    .filter(r => r.impressions > 500 && r.ctr < 3)
    .map(r => ({
      keyword:     r.keyword,
      url:         r.url,
      position:    r.position,
      impressions: r.impressions,
      clicks:      r.clicks,
      ctr:         r.ctr,
      gapType:     'low_ctr',
      description: `Impressions ${r.impressions} but CTR only ${r.ctr}% — meta title/description needs improvement.`,
    }));
}

/**
 * Category B: Ranking 11-20 — easy wins just outside top 10.
 */
function findEasyWins(rankings) {
  return rankings
    .filter(r => r.position >= 11 && r.position <= 20)
    .map(r => ({
      keyword:     r.keyword,
      url:         r.url,
      position:    r.position,
      impressions: r.impressions,
      clicks:      r.clicks,
      ctr:         r.ctr,
      gapType:     'ranking_11_20',
      description: `Ranked #${r.position} — just outside top 10. A content boost could push this into top results.`,
    }));
}

/**
 * Category C: High bounce pages — ranking well but not converting.
 * Only available if we have audit data with bounce_rate.
 */
function findHighBouncePages(rankings, pageAudits) {
  if (pageAudits.size === 0) return [];

  const results = [];
  for (const r of rankings) {
    if (r.position > 10) continue; // only care about well-ranking pages
    const audit = pageAudits.get(r.url);
    if (audit && typeof audit.bounce_rate === 'number' && audit.bounce_rate > 60) {
      results.push({
        keyword:    r.keyword,
        url:        r.url,
        position:   r.position,
        bounceRate: audit.bounce_rate,
        gapType:    'high_bounce',
        description: `Ranked #${r.position} but bounce rate is ${audit.bounce_rate}% — page experience or content mismatch.`,
      });
    }
  }
  return results;
}

/**
 * Category D: Keyword gaps — target keywords we're NOT ranking for at all.
 */
function findKeywordGaps(targetKeywords, rankedKeywords) {
  const rankedSet = new Set(rankedKeywords);
  return targetKeywords
    .filter(kw => !rankedSet.has(kw))
    .map(kw => ({
      keyword:     kw,
      url:         null,
      position:    null,
      gapType:     'missing_keyword',
      description: `Target keyword "${kw}" has zero ranking presence — needs dedicated content.`,
    }));
}

/**
 * Category E: Pages without meta descriptions (from audit data).
 */
function findMissingMetaPages(rankings, pageAudits) {
  if (pageAudits.size === 0) return [];

  const results = [];
  for (const r of rankings) {
    const audit = pageAudits.get(r.url);
    if (audit && audit.has_meta_description === false) {
      results.push({
        keyword:      r.keyword,
        url:          r.url,
        position:     r.position,
        gapType:      'missing_meta',
        description:  'Page has no meta description — missing optimisation opportunity.',
      });
    }
  }
  return results;
}

/**
 * Category F: Thin content — pages ranking 10-30 but not blog posts.
 * We consider a page "thin" if it's a homepage, product page, or
 * category page that isn't backed by substantive content.
 */
function findThinContentPages(rankings, pageAudits) {
  if (pageAudits.size === 0) return [];

  const thinTypes = new Set(['homepage', 'product', 'category', 'landing', 'tag']);
  const results = [];

  for (const r of rankings) {
    if (r.position < 10 || r.position > 30) continue;
    const audit = pageAudits.get(r.url);
    if (audit) {
      const type = (audit.content_type || audit.page_type || '').toLowerCase();
      if (thinTypes.has(type)) {
        results.push({
          keyword:     r.keyword,
          url:         r.url,
          position:    r.position,
          contentType: type,
          gapType:     'thin_content',
          description: `Ranked #${r.position} on a "${type}" page — needs a dedicated blog post to strengthen.`,
        });
      }
    }
  }
  return results;
}

// ─────────────────────────────────────────────────────────────
//  Priority Scoring
// ─────────────────────────────────────────────────────────────

/**
 * Score each gap 0–100 based on its type and attributes.
 */
function scoreGap(gap) {
  let score = 0;

  switch (gap.gapType) {
    case 'ranking_11_20':
      score += 40; // easy win
      // Bonus for being closer to 10
      if (gap.position <= 13) score += 10;
      if (gap.position <= 15) score += 5;
      break;

    case 'low_ctr':
      score += 30;
      // Bonus for very high impressions
      if (gap.impressions > 5000) score += 15;
      else if (gap.impressions > 2000) score += 10;
      else if (gap.impressions > 1000) score += 5;
      // Bonus for very low CTR
      if (gap.ctr < 1) score += 10;
      break;

    case 'missing_meta':
      score += 20;
      // Bonus if page ranks well and is missing meta
      if (gap.position <= 20) score += 10;
      break;

    case 'missing_keyword':
      score += 25;
      break;

    case 'high_bounce':
      score += 30;
      if (gap.bounceRate > 80) score += 10;
      if (gap.position <= 5) score += 5;
      break;

    case 'thin_content':
      score += 25;
      if (gap.position <= 15) score += 10;
      break;

    default:
      score += 10;
  }

  // Bonus for blog-like URLs (indicates higher likelihood of improvement)
  if (gap.url) {
    const url = gap.url.toLowerCase();
    if (url.includes('/blog/') || url.includes('/article/') || url.includes('/guide/') || url.includes('/post/')) {
      score += 15;
    }
  }

  return Math.min(score, 100);
}

/**
 * Determine the suggested action type based on the gap.
 */
function suggestAction(gap) {
  switch (gap.gapType) {
    case 'low_ctr':
      return { type: 'update-meta', effort: 20 };
    case 'ranking_11_20':
      return { type: 'optimize-content', effort: 45 };
    case 'high_bounce':
      return { type: 'optimize-content', effort: 60 };
    case 'missing_keyword':
      return { type: 'generate-post', effort: 120 };
    case 'missing_meta':
      return { type: 'update-meta', effort: 10 };
    case 'thin_content':
      return { type: 'generate-post', effort: 90 };
    default:
      return { type: 'optimize-content', effort: 30 };
  }
}

// ─────────────────────────────────────────────────────────────
//  Output Writer
// ─────────────────────────────────────────────────────────────

async function outputResults(allGaps, topTargets) {
  await mkdir(ANALYSIS_DIR, { recursive: true });

  // Full gap report
  const gapReport = {
    generatedAt: new Date().toISOString(),
    totalGaps:   allGaps.length,
    highPriority: topTargets.length,
    gaps:        allGaps,
  };
  await writeFile(GAP_OUTPUT_PATH, JSON.stringify(gapReport, null, 2), 'utf-8');

  // Top 5 prioritised targets
  await writeFile(OPTIMISATION_OUTPUT, JSON.stringify(topTargets, null, 2), 'utf-8');

  // ── Console summary ────────────────────────────────────
  const byType = {};
  for (const g of allGaps) {
    byType[g.gapType] = (byType[g.gapType] || 0) + 1;
  }

  console.log('');
  console.log('=== CONTENT GAPS ===');
  console.log(`Total gaps found: ${allGaps.length}`);
  console.log(`High priority (top 5): ${topTargets.length}`);
  if (byType.ranking_11_20)  console.log(`Easy wins (rank 11-20):   ${byType.ranking_11_20}`);
  if (byType.missing_keyword) console.log(`Missing keywords:         ${byType.missing_keyword}`);
  if (byType.low_ctr)         console.log(`Low CTR pages:            ${byType.low_ctr}`);
  if (byType.high_bounce)     console.log(`High bounce pages:        ${byType.high_bounce}`);
  if (byType.missing_meta)    console.log(`Missing meta descriptions: ${byType.missing_meta}`);
  if (byType.thin_content)    console.log(`Thin content pages:        ${byType.thin_content}`);
  console.log('');

  console.log('🏆 Top 5 Prioritised Targets:');
  for (const [idx, t] of topTargets.entries()) {
    console.log(`   ${idx + 1}. [${t.priorityScore}/100] "${t.keyword || t.url}" — ${t.actionType} (${t.effort} min)`);
  }
  console.log('');
}

// ─────────────────────────────────────────────────────────────
//  Main Entry Point
// ─────────────────────────────────────────────────────────────

async function main() {
  try {
    // 1. Read all inputs
    const [rankingData, keywordData, auditData] = await Promise.all([
      readJSON(RANKINGS_TODAY_PATH),
      readJSON(KEYWORDS_PATH),
      readJSON(AUDIT_TODAY_PATH),
    ]);

    if (!rankingData) {
      console.log('❌ No rankings-today.json found. Run the SCAN step first.');
      process.exit(1);
    }

    const rankings     = extractRankings(rankingData);
    const targetKw     = extractKeywords(keywordData);
    const pageAudits   = extractPageAudits(auditData);

    if (rankings.length === 0) {
      console.log('❌ rankings-today.json has no valid ranking entries.');
      process.exit(1);
    }

    const rankedKeywords = rankings.map(r => r.keyword.toLowerCase().trim());

    // 2. Run each gap analysis
    const allGaps = [
      ...findLowCTRPages(rankings),
      ...findEasyWins(rankings),
      ...findHighBouncePages(rankings, pageAudits),
      ...findKeywordGaps(targetKw, rankedKeywords),
      ...findMissingMetaPages(rankings, pageAudits),
      ...findThinContentPages(rankings, pageAudits),
    ];

    if (allGaps.length === 0) {
      console.log('✅ No content gaps found — everything looks good!');
      await outputResults([], []);
      return;
    }

    // 3. Score, enrich, and sort
    const enriched = allGaps.map(g => {
      const action = suggestAction(g);
      return {
        keyword:      g.keyword,
        url:          g.url,
        currentState: g.description,
        gapType:      g.gapType,
        position:     g.position ?? null,
        priorityScore: scoreGap(g),
        actionType:   action.type,
        effort:       action.effort,
      };
    });

    enriched.sort((a, b) => b.priorityScore - a.priorityScore);

    // 4. Top 5 prioritised targets (with rank)
    const topTargets = enriched.slice(0, 5).map((t, i) => ({
      rank:          i + 1,
      ...t,
    }));

    // 5. Output
    await outputResults(enriched, topTargets);

    console.log(`📄 Full gaps        → ${GAP_OUTPUT_PATH}`);
    console.log(`📄 Optimisation targets → ${OPTIMISATION_OUTPUT}`);
  } catch (err) {
    console.error('❌ content-gap.js failed:', err.message);
    process.exit(1);
  }
}

main();
