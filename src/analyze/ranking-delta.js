/**
 * ranking-delta.js — Analyze Module
 *
 * Compares today's rankings with yesterday's to detect changes, categorize
 * winners/losers/new/lost keywords, and flag urgent fixes (drops > 3).
 *
 * Part of the Daily SEO Auto-Optimization Loop.
 *
 * Inputs:
 *   data/rankings/rankings-today.json   — today's ranking snapshot
 *   data/rankings/rankings-history.json — historical ranking snapshots
 *
 * Outputs:
 *   data/analysis/ranking-delta.json    — full delta analysis
 *   data/analysis/urgent-fixes.json     — keywords that dropped >= 3 positions
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

const RANKINGS_TODAY_PATH    = join(DATA_DIR, 'rankings', 'rankings-today.json');
const RANKINGS_HISTORY_PATH  = join(DATA_DIR, 'rankings', 'rankings-history.json');
const ANALYSIS_DIR           = join(DATA_DIR, 'analysis');
const DELTA_OUTPUT_PATH      = join(ANALYSIS_DIR, 'ranking-delta.json');
const URGENT_FIXES_PATH      = join(ANALYSIS_DIR, 'urgent-fixes.json');

// ─────────────────────────────────────────────────────────────
//  Today's Date
// ─────────────────────────────────────────────────────────────

function getTodayISO() {
  return new Date().toISOString().slice(0, 10); // "2026-07-12"
}

// ─────────────────────────────────────────────────────────────
//  Data Readers
// ─────────────────────────────────────────────────────────────

/**
 * Read and parse a JSON file. Returns `null` if the file doesn't
 * exist or can't be parsed.
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
 * Normalise a ranking entry so we always have a consistent shape.
 */
function normaliseRankingEntry(raw) {
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
 * Extract a flat array of ranking entries from a variety of
 * supported data shapes.
 *
 * Shapes supported:
 *   - { date, rankings: [...] }     object with rankings array
 *   - [...]                         plain array of entries directly
 */
function extractRankings(data) {
  if (!data) return [];

  if (Array.isArray(data)) {
    // If it's an array of objects with a `keyword` field treat as entries
    if (data.length > 0 && typeof data[0] === 'object' && 'keyword' in data[0]) {
      return data.map(normaliseRankingEntry);
    }
    // Otherwise it might be an array of snapshots – try to find yesterday's
    return data;
  }

  if (typeof data === 'object' && data !== null) {
    if (Array.isArray(data.rankings)) {
      return data.rankings.map(normaliseRankingEntry);
    }
  }

  return [];
}

/**
 * Find the most recent historical snapshot that isn't today.
 * Expects `history` to be an array of { date, rankings } objects
 * or a single { date, rankings } object.
 */
function findYesterdayData(history, todayISO) {
  if (!history) return null;

  // Single snapshot object
  if (!Array.isArray(history) && typeof history === 'object') {
    if (history.date !== todayISO && Array.isArray(history.rankings)) {
      return { date: history.date, rankings: history.rankings.map(normaliseRankingEntry) };
    }
    return null;
  }

  // Array of snapshots — find the latest entry before today
  const snapshots = history
    .filter(s => s && s.date && s.date !== todayISO && Array.isArray(s.rankings))
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  if (snapshots.length === 0) return null;

  const latest = snapshots[0];
  return { date: latest.date, rankings: latest.rankings.map(normaliseRankingEntry) };
}

// ─────────────────────────────────────────────────────────────
//  Delta Calculation
// ─────────────────────────────────────────────────────────────

function buildKeywordMap(rankings) {
  const map = new Map();
  for (const entry of rankings) {
    const key = entry.keyword.toLowerCase().trim();
    // Keep the first occurrence if there are duplicates (shouldn't happen)
    if (!map.has(key)) {
      map.set(key, entry);
    }
  }
  return map;
}

function calculateDelta(yesterday, today, todayDate, yesterdayDate) {
  const todayMap    = buildKeywordMap(today);
  const yesterdayMap = buildKeywordMap(yesterday);

  const deltas     = [];
  const losers     = [];
  const todayKeywords = new Set(todayMap.keys());
  const yesterdayKeywords = new Set(yesterdayMap.keys());

  let improvedCount = 0;
  let droppedCount  = 0;
  let totalPositionChange = 0;
  let bestKeyword  = null;
  let worstKeyword = null;

  // Common keywords — compute delta
  for (const keyword of todayKeywords) {
    const t     = todayMap.get(keyword);
    const y     = yesterdayMap.get(keyword);

    if (y) {
      const positionChange = y.position - t.position; // positive = improvement
      const clickChange    = t.clicks - y.clicks;
      const impressionChange = t.impressions - y.impressions;
      const ctrChange      = t.ctr - y.ctr;

      totalPositionChange += positionChange;

      if (positionChange > 0) improvedCount++;
      else if (positionChange < 0) droppedCount++;

      const delta = {
        keyword:         t.keyword,
        url:             t.url,
        yesterdayPos:    y.position,
        todayPos:        t.position,
        positionChange,
        yesterdayClicks: y.clicks,
        todayClicks:     t.clicks,
        clickChange,
        yesterdayImpressions: y.impressions,
        todayImpressions:     t.impressions,
        impressionChange,
        yesterdayCTR:    y.ctr,
        todayCTR:        t.ctr,
        ctrChange,
        category:        'stable',
      };

      // Categorise
      if (positionChange >= 2) {
        delta.category = 'winner';
      } else if (positionChange <= -3) {
        delta.category = 'loser';
      }

      deltas.push(delta);

      // Track best / worst
      if (!bestKeyword  || positionChange > bestKeyword.change)  bestKeyword  = { keyword: t.keyword, change: positionChange, from: y.position, to: t.position };
      if (!worstKeyword || positionChange < worstKeyword.change) worstKeyword = { keyword: t.keyword, change: positionChange, from: y.position, to: t.position };

      // Collect losers (drop >= 3)
      if (positionChange <= -3) {
        losers.push({
          keyword:         t.keyword,
          url:             t.url,
          previousPos:     y.position,
          currentPos:      t.position,
          drop:            Math.abs(positionChange),
          clicksLost:      clickChange < 0 ? Math.abs(clickChange) : 0,
          impressionsLost: impressionChange < 0 ? Math.abs(impressionChange) : 0,
          priority:        positionChange <= -5 ? 'critical' : 'high',
        });
      }
    }
  }

  // New keywords (in today but not yesterday)
  const newKeywords = [];
  for (const keyword of todayKeywords) {
    if (!yesterdayKeywords.has(keyword)) {
      const t = todayMap.get(keyword);
      newKeywords.push({
        keyword:     t.keyword,
        url:         t.url,
        position:    t.position,
        impressions: t.impressions,
        clicks:      t.clicks,
        category:    'new',
      });
      deltas.push({
        keyword:             t.keyword,
        url:                 t.url,
        yesterdayPos:        null,
        todayPos:            t.position,
        positionChange:      null,
        yesterdayClicks:     null,
        todayClicks:         t.clicks,
        clickChange:         null,
        yesterdayImpressions: null,
        todayImpressions:     t.impressions,
        impressionChange:     null,
        yesterdayCTR:        null,
        todayCTR:            t.ctr,
        ctrChange:           null,
        category:            'new',
      });
    }
  }

  // Lost keywords (in yesterday but not today)
  const lostKeywords = [];
  for (const keyword of yesterdayKeywords) {
    if (!todayKeywords.has(keyword)) {
      const y = yesterdayMap.get(keyword);
      lostKeywords.push({
        keyword:     y.keyword,
        url:         y.url,
        lastSeenPos: y.position,
        lastSeenDate: yesterdayDate,
        category:    'lost',
      });
      deltas.push({
        keyword:             y.keyword,
        url:                 y.url,
        yesterdayPos:        y.position,
        todayPos:            null,
        positionChange:      null,
        yesterdayClicks:     y.clicks,
        todayClicks:         null,
        clickChange:         null,
        yesterdayImpressions: y.impressions,
        todayImpressions:     null,
        impressionChange:     null,
        yesterdayCTR:        y.ctr,
        todayCTR:            null,
        ctrChange:           null,
        category:            'lost',
      });
    }
  }

  // ── Distribution counts ─────────────────────────────────
  const top3   = today.filter(r => r.position <= 3);
  const top10  = today.filter(r => r.position <= 10);
  const top30  = today.filter(r => r.position <= 30);
  const top100 = today.filter(r => r.position <= 100);

  // ── Also compute top-10 / top-30 changes ────────────────
  const yesterdayTop10 = yesterday.filter(r => r.position <= 10).length;
  const yesterdayTop30 = yesterday.filter(r => r.position <= 30).length;
  const todayTop10     = top10.length;
  const todayTop30     = top30.length;
  const top10Change    = todayTop10 - yesterdayTop10;
  const top30Change    = todayTop30 - yesterdayTop30;

  // ── Average position change ─────────────────────────────
  const countedDeltas = deltas.filter(d => d.positionChange !== null);
  const avgPositionChange = countedDeltas.length > 0
    ? (totalPositionChange / countedDeltas.length)
    : 0;

  return {
    analysisDate: todayDate,
    yesterdayDate,
    summary: {
      totalTracked:        today.length,
      improved:            improvedCount,
      dropped:             droppedCount,
      new:                 newKeywords.length,
      lost:                lostKeywords.length,
      stable:              countedDeltas.length - improvedCount - droppedCount,
      top3:                top3.length,
      top10:               todayTop10,
      top10Change,
      top30:               todayTop30,
      top30Change,
      top100:              top100.length,
      averagePositionChange: Math.round(avgPositionChange * 100) / 100,
      bestKeyword:         bestKeyword  ? `${bestKeyword.keyword} ${bestKeyword.from}→${bestKeyword.to} (${bestKeyword.change >= 0 ? '+' : ''}${bestKeyword.change})` : null,
      worstKeyword:        worstKeyword ? `${worstKeyword.keyword} ${worstKeyword.from}→${worstKeyword.to} (${worstKeyword.change})` : null,
    },
    deltas,
    newKeywords,
    lostKeywords,
    losers,
  };
}

// ─────────────────────────────────────────────────────────────
//  Output Writers
// ─────────────────────────────────────────────────────────────

function formatChange(val) {
  if (val === null || val === undefined) return '-';
  if (val > 0) return `+${val}`;
  return String(val);
}

/**
 * Persist the result and print a readable console summary.
 */
async function outputResults(result) {
  await mkdir(ANALYSIS_DIR, { recursive: true });

  // Full delta
  await writeFile(DELTA_OUTPUT_PATH, JSON.stringify(result, null, 2), 'utf-8');

  // Urgent fixes — only losers (drop >= 3) sorted by severity
  const urgent = {
    generatedAt: result.analysisDate,
    count:       result.losers.length,
    fixes:       result.losers.sort((a, b) => b.drop - a.drop || b.priority.localeCompare(a.priority)),
  };
  await writeFile(URGENT_FIXES_PATH, JSON.stringify(urgent, null, 2), 'utf-8');

  // ── Console summary ────────────────────────────────────
  const s = result.summary;
  console.log('');
  console.log('=== RANKING DELTA ===');
  console.log(`Keywords tracked: ${s.totalTracked}`);
  console.log(`Improved: ${s.improved} | Dropped: ${s.dropped} | New: ${s.new} | Lost: ${s.lost}`);
  console.log(`Top 10: ${s.top10} (${formatChange(s.top10Change)}) | Top 30: ${s.top30} (${formatChange(s.top30Change)})`);
  console.log(`Avg position change: ${formatChange(s.averagePositionChange)}`);
  if (s.bestKeyword)  console.log(`Biggest gain:  "${s.bestKeyword}"`);
  if (s.worstKeyword) console.log(`Biggest drop:  "${s.worstKeyword}"`);
  if (urgent.count > 0) {
    console.log(`\n⚠️  Urgent fixes needed: ${urgent.count} keyword(s) dropped >=3 positions`);
    for (const l of urgent.fixes.slice(0, 5)) {
      console.log(`   - "${l.keyword}" ${l.previousPos}→${l.currentPos} (drop: ${l.drop}) [${l.priority}]`);
    }
    if (urgent.fixes.length > 5) console.log(`   ... and ${urgent.fixes.length - 5} more`);
  }
  console.log('');
}

// ─────────────────────────────────────────────────────────────
//  Main Entry Point
// ─────────────────────────────────────────────────────────────

async function main() {
  try {
    const todayISO = getTodayISO();

    // 1. Read today's rankings
    const todayData = await readJSON(RANKINGS_TODAY_PATH);
    if (!todayData) {
      console.log('❌ No rankings-today.json found. Run the SCAN step first.');
      process.exit(1);
    }

    const todayRankings = extractRankings(todayData);
    if (todayRankings.length === 0) {
      console.log('❌ rankings-today.json is empty or has invalid format.');
      process.exit(1);
    }

    // 2. Read history
    const historyData = await readJSON(RANKINGS_HISTORY_PATH);
    const yesterday   = findYesterdayData(historyData, todayISO);

    // 3. First run – save baseline
    if (!yesterday) {
      console.log('📦 First run detected — saving today as baseline.');

      // Build/update history file
      const historyEntry = { date: todayISO, rankings: todayRankings };
      let newHistory = [];

      if (Array.isArray(historyData)) {
        // Remove any existing entry for today then append
        newHistory = historyData.filter(s => s.date !== todayISO);
        newHistory.push(historyEntry);
      } else if (historyData && typeof historyData === 'object' && historyData.date) {
        // Was a single snapshot — convert to array
        newHistory = [historyData, historyEntry];
      } else {
        // Brand new history
        newHistory = [historyEntry];
      }

      await mkdir(dirname(RANKINGS_HISTORY_PATH), { recursive: true });
      await writeFile(RANKINGS_HISTORY_PATH, JSON.stringify(newHistory, null, 2), 'utf-8');

      console.log('✅ Baseline saved to rankings-history.json');
      console.log('ℹ️  Run the ANALYZE step again tomorrow to see deltas.');
      process.exit(0);
    }

    // 4. We have both today and yesterday — compute delta
    const result = calculateDelta(yesterday.rankings, todayRankings, todayISO, yesterday.date);

    // 5. Save results & print summary
    await outputResults(result);

    console.log(`📄 Full delta  → ${DELTA_OUTPUT_PATH}`);
    console.log(`📄 Urgent fixes → ${URGENT_FIXES_PATH}`);
  } catch (err) {
    console.error('❌ ranking-delta.js failed:', err.message);
    process.exit(1);
  }
}

main();
