/**
 * priority.js — Analyze Module
 *
 * Merges all analysis outputs (urgent ranking fixes, content optimisation
 * targets, broken links, and technical audit issues) into a single
 * prioritised action list for today's optimisation run.
 *
 * Part of the Daily SEO Auto-Optimization Loop.
 *
 * Inputs:
 *   data/analysis/urgent-fixes.json        — ranking drops >= 3 (from ranking-delta.js)
 *   data/analysis/optimization-targets.json — content gaps (from content-gap.js)
 *   data/audits/broken-links-today.json    — broken links (from SCAN, optional)
 *   data/audits/audit-today.json           — technical audit (from SCAN, optional)
 *
 * Outputs:
 *   data/analysis/today-priority.json      — merged, prioritised action list (max 10)
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
const ANALYSIS_DIR = join(DATA_DIR, 'analysis');

const URGENT_FIXES_PATH       = join(ANALYSIS_DIR, 'urgent-fixes.json');
const OPTIMISATION_TARGETS    = join(ANALYSIS_DIR, 'optimization-targets.json');
const BROKEN_LINKS_PATH       = join(DATA_DIR, 'audits', 'broken-links-today.json');
const AUDIT_TODAY_PATH        = join(DATA_DIR, 'audits', 'audit-today.json');
const PRIORITY_OUTPUT_PATH    = join(ANALYSIS_DIR, 'today-priority.json');

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

// ─────────────────────────────────────────────────────────────
//  Action Builders
// ─────────────────────────────────────────────────────────────

/**
 * Build actions from urgent ranking fixes (ranking-delta.js output).
 * Expects shape: { fixes: [ { keyword, url, previousPos, currentPos, drop, priority } ] }
 *
 * - drop >= 5  → P0
 * - drop 3-4   → P1
 */
function buildRankingFixActions(urgentData) {
  if (!urgentData || !Array.isArray(urgentData.fixes)) return [];

  return urgentData.fixes.map(fix => {
    const drop = fix.drop ?? 0;
    const priorityLevel = drop >= 5 ? 'P0' : 'P1';
    const priorityScore = Math.min(100, 40 + drop * 10);

    return {
      id:            `drop-${fix.keyword?.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}`,
      actionType:    'optimize-content',
      priority:      priorityLevel,
      priorityScore,
      target:        fix.keyword || 'unknown',
      targetUrl:     fix.url || null,
      currentState:  `Ranking dropped from #${fix.previousPos} to #${fix.currentPos} (drop of ${drop} positions)`,
      suggestedAction: fix.priority === 'critical'
        ? `Critical ranking drop for "${fix.keyword}" — investigate immediately, check for site issues, competitors, or content changes.`
        : `Ranking drop for "${fix.keyword}" (${fix.previousPos} → ${fix.currentPos}) — refresh content, improve internal links, and update meta.`,
      effort:        drop >= 5 ? 30 : 45, // minutes
      source:        'ranking-delta',
      meta: {
        previousPos: fix.previousPos,
        currentPos:  fix.currentPos,
        drop,
        clicksLost:  fix.clicksLost ?? 0,
        impressionsLost: fix.impressionsLost ?? 0,
      },
    };
  });
}

/**
 * Build actions from optimisation targets (content-gap.js output).
 * Expects an array of { rank, keyword, url, currentState, gapType, priorityScore, actionType, effort }.
 */
function buildOptimisationActions(targets) {
  if (!Array.isArray(targets) || targets.length === 0) return [];

  return targets.map(t => {
    // Map gap types to priority levels
    let priorityLevel;
    switch (t.gapType) {
      case 'missing_meta':
        priorityLevel = 'P1';
        break;
      case 'ranking_11_20':
      case 'low_ctr':
        priorityLevel = 'P2';
        break;
      case 'missing_keyword':
      case 'thin_content':
      case 'high_bounce':
        priorityLevel = 'P2';
        break;
      default:
        priorityLevel = 'P3';
    }

    return {
      id:            `opt-${t.gapType}-${(t.keyword || t.url || '').replace(/\s+/g, '-').toLowerCase().slice(0, 40)}-${Date.now()}`,
      actionType:    t.actionType || 'optimize-content',
      priority:      priorityLevel,
      priorityScore: t.priorityScore ?? 50,
      target:        t.keyword || 'unknown',
      targetUrl:     t.url || null,
      currentState:  t.currentState || 'Optimisation opportunity identified.',
      suggestedAction: buildActionSuggestion(t),
      effort:        t.effort ?? 30,
      source:        'content-gap',
      meta: {
        gapType:     t.gapType,
        position:    t.position ?? null,
      },
    };
  });
}

function buildActionSuggestion(target) {
  switch (target.gapType) {
    case 'low_ctr':
      return `Rewrite meta title and description for "${target.keyword}" to improve CTR (currently scoring on impressions but low clicks).`;
    case 'ranking_11_20':
      return `Boost content for "${target.keyword}" — add more depth, update stats, improve internal linking, and strengthen on-page SEO.`;
    case 'high_bounce':
      return `Improve page experience for "${target.keyword}" — high bounce rate despite good ranking. Review content relevance, page speed, and CTA.`;
    case 'missing_keyword':
      return `Create new content targeting "${target.keyword}" — currently not ranking at all for this valuable keyword.`;
    case 'missing_meta':
      return `Add a compelling meta description for the page ranking for "${target.keyword}".`;
    case 'thin_content':
      return `Strengthen "${target.keyword}" with a dedicated blog post or guide — currently ranking on a thin ${target.contentType || 'page'} page.`;
    default:
      return `Review and optimise content for "${target.keyword}".`;
  }
}

/**
 * Build actions from broken links (scan step output).
 * Expects shape: { brokenLinks: [ { url, statusCode, foundOn, anchorText } ] }
 *
 * All broken links are P0 — they harm user experience and SEO.
 */
function buildBrokenLinkActions(brokenData) {
  if (!brokenData) return [];

  // Support multiple shapes
  const links = brokenData.brokenLinks || brokenData.links || brokenData.results ||
                (Array.isArray(brokenData) ? brokenData : []);

  if (!Array.isArray(links) || links.length === 0) return [];

  return links.slice(0, 20).map((link, i) => {  // cap at 20 to avoid overload
    const url = link.url || link.brokenUrl || link.href || `unknown-${i}`;
    return {
      id:            `broken-link-${url.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 30)}-${Date.now()}`,
      actionType:    'fix-broken-link',
      priority:      'P0',
      priorityScore: 100,
      target:        url,
      targetUrl:     url,
      currentState:  `Broken link ${link.statusCode ? `(HTTP ${link.statusCode})` : ''} — found on "${link.foundOn || link.source || 'unknown page'}"`,
      suggestedAction: `Fix or remove broken link: ${url}. ${link.anchorText ? `Anchor text: "${link.anchorText}".` : ''} Redirect or update the link target.`,
      effort:        15, // minutes
      source:        'broken-links',
      meta: {
        statusCode: link.statusCode ?? null,
        foundOn:    link.foundOn || link.source || null,
        anchorText: link.anchorText ?? null,
      },
    };
  });
}

/**
 * Build actions from the technical audit (scan step output).
 * Expects shape: { issues: [ { severity, type, description, url } ] }
 * or { pages: [ ... ] } with embedded issues.
 *
 * - SSL issues, site-down, noindex → P0
 * - Missing schemas, broken meta tags → P1
 * - Missing hreflang, slow pages → P2
 * - Suggestions → P3
 */
function buildAuditActions(auditData) {
  if (!auditData) return [];

  const issues = [];

  // Array of issues
  if (Array.isArray(auditData.issues)) {
    issues.push(...auditData.issues);
  }

  // Issues nested in pages
  if (Array.isArray(auditData.pages)) {
    for (const page of auditData.pages) {
      if (Array.isArray(page.issues)) {
        for (const iss of page.issues) {
          issues.push({ ...iss, url: iss.url || page.url });
        }
      }
      // Single-field flags
      if (page.has_meta_description === false) {
        issues.push({ type: 'missing_meta', severity: 'high', url: page.url });
      }
    }
  }

  // Flat array at root
  if (Array.isArray(auditData)) {
    issues.push(...auditData);
  }

  if (issues.length === 0) return [];

  const severityMap = {
    critical: 'P0',
    high:     'P1',
    medium:   'P2',
    low:      'P3',
  };

  const actions = [];
  for (const issue of issues) {
    const severity = (issue.severity || 'medium').toLowerCase();
    const priorityLevel = severityMap[severity] || 'P2';

    // Determine action type
    let actionType = 'optimize-content';
    if (/ssl|certificate|https/i.test(issue.type || '')) actionType = 'fix-broken-link';
    else if (/schema|structured.?data/i.test(issue.type || '')) actionType = 'optimize-content';
    else if (/meta|title|description/i.test(issue.type || '')) actionType = 'update-meta';
    else if (/noindex|canonical|robots/i.test(issue.type || '')) actionType = 'optimize-content';
    else if (/hreflang|alternate/i.test(issue.type || '')) actionType = 'optimize-content';
    else if (/redirect|301|302/i.test(issue.type || '')) actionType = 'fix-broken-link';
    else if (/canonical/i.test(issue.type || '')) actionType = 'optimize-content';

    const effortMap = { P0: 20, P1: 30, P2: 40, P3: 20 };
    const scoreMap  = { P0: 95, P1: 75, P2: 55, P3: 30 };

    const url = issue.url || issue.pageUrl || null;

    actions.push({
      id:            `audit-${(issue.type || 'issue').replace(/\s+/g, '-').toLowerCase()}-${url ? url.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 20) : 'global'}-${Date.now()}`,
      actionType,
      priority:      priorityLevel,
      priorityScore: scoreMap[priorityLevel] || 50,
      target:        issue.type || 'Technical issue',
      targetUrl:     url,
      currentState:  issue.description || issue.message || `Technical issue detected: ${issue.type}`,
      suggestedAction: `Resolve: ${issue.description || issue.type}${url ? ` on ${url}` : ''}`,
      effort:        effortMap[priorityLevel] || 30,
      source:        'technical-audit',
      meta: {
        issueType: issue.type ?? null,
        severity:  severity,
      },
    });
  }

  return actions;
}

// ─────────────────────────────────────────────────────────────
//  Merge & Prioritise
// ─────────────────────────────────────────────────────────────

const PRIORITY_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 };

function mergeAndPrioritise(actions) {
  // De-duplicate by target + actionType to avoid noisy duplicates
  const seen = new Set();
  const deduped = [];

  for (const a of actions) {
    const dedupKey = `${a.actionType}:${a.target}:${a.targetUrl || ''}`;
    if (!seen.has(dedupKey)) {
      seen.add(dedupKey);
      deduped.push(a);
    }
  }

  // Sort: priority level first, then by score descending, then by effort ascending
  deduped.sort((a, b) => {
    const levelDiff = (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99);
    if (levelDiff !== 0) return levelDiff;
    const scoreDiff = (b.priorityScore ?? 0) - (a.priorityScore ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    return (a.effort ?? 99) - (b.effort ?? 99);
  });

  // Limit to max 10 actions
  return deduped.slice(0, 10);
}

// ─────────────────────────────────────────────────────────────
//  Output Writer
// ─────────────────────────────────────────────────────────────

async function outputResults(actions) {
  await mkdir(ANALYSIS_DIR, { recursive: true });

  const grouped = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const a of actions) {
    const level = a.priority || 'P3';
    grouped[level] = (grouped[level] || 0) + 1;
  }

  const output = {
    generatedAt: new Date().toISOString(),
    totalActions: actions.length,
    summary: {
      P0: grouped.P0,
      P1: grouped.P1,
      P2: grouped.P2,
      P3: grouped.P3,
    },
    actions,
  };

  await writeFile(PRIORITY_OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf-8');

  // ── Console summary ────────────────────────────────────
  console.log('');
  console.log("=== TODAY'S PRIORITY ACTIONS ===");
  console.log(`P0 Critical: ${grouped.P0}`);
  console.log(`P1 High:     ${grouped.P1}`);
  console.log(`P2 Medium:   ${grouped.P2}`);
  console.log(`P3 Low:      ${grouped.P3}`);
  console.log(`Total: ${actions.length} actions`);
  console.log('');

  if (actions.length > 0) {
    console.log('Action List:');
    for (const [i, a] of actions.entries()) {
      const effortLabel = a.effort <= 15 ? '⚡ quick' : a.effort <= 30 ? '👍 short' : a.effort <= 60 ? '⏳ medium' : '🧱 long';
      console.log(`  ${i + 1}. [${a.priority}] ${a.actionType} — "${a.target}" (${a.effort} min, ${effortLabel})`);
      console.log(`     ${a.currentState}`);
    }
  }
  console.log('');
}

// ─────────────────────────────────────────────────────────────
//  Main Entry Point
// ─────────────────────────────────────────────────────────────

async function main() {
  try {
    // 1. Read all inputs in parallel
    const [urgentData, optimisationTargets, brokenData, auditData] = await Promise.all([
      readJSON(URGENT_FIXES_PATH),
      readJSON(OPTIMISATION_TARGETS),
      readJSON(BROKEN_LINKS_PATH),
      readJSON(AUDIT_TODAY_PATH),
    ]);

    // 2. Build action lists from each source
    const rankingActions   = buildRankingFixActions(urgentData);
    const optimisationActs = buildOptimisationActions(
      Array.isArray(optimisationTargets) ? optimisationTargets
        : optimisationTargets?.targets ?? optimisationTargets?.optimizationTargets ?? []
    );
    const brokenActions    = buildBrokenLinkActions(brokenData);
    const auditActions     = buildAuditActions(auditData);

    const allActions = [
      ...rankingActions,
      ...optimisationActs,
      ...brokenActions,
      ...auditActions,
    ];

    if (allActions.length === 0) {
      console.log('✅ No urgent actions needed — everything is healthy.');
      await outputResults([]);
      console.log(`📄 Priority → ${PRIORITY_OUTPUT_PATH}`);
      return;
    }

    // 3. Merge, de-duplicate, sort, and cap at 10
    const prioritised = mergeAndPrioritise(allActions);

    // 4. Output
    await outputResults(prioritised);

    console.log(`📄 Today priority → ${PRIORITY_OUTPUT_PATH}`);
    console.log(`   (${allActions.length} raw actions consolidated to ${prioritised.length} prioritised actions)`);
  } catch (err) {
    console.error('❌ priority.js failed:', err.message);
    process.exit(1);
  }
}

main();
