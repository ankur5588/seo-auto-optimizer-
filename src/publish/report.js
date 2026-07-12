import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const DATA_DIR = path.join(PROJECT_ROOT, "data");
const REPORTS_DIR = path.join(PROJECT_ROOT, "reports", "daily");

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function readDirFiles(dirPath, pattern) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const todayStr = today();
    const files = [];

    for (const entry of entries) {
      if (entry.isFile() && pattern(entry.name, todayStr)) {
        const content = await fs.readFile(path.join(dirPath, entry.name), "utf-8");
        try {
          files.push({ name: entry.name, data: JSON.parse(content) });
        } catch {
          files.push({ name: entry.name, data: content });
        }
      }
    }

    return files;
  } catch {
    return [];
  }
}

function todayPattern(name, todayStr) {
  return name.includes(todayStr) || name.includes("today") || name.includes(todayStr.replace(/-/g, ""));
}

function readJson(filePath, defaultValue = null) {
  try {
    const content = fs.readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return defaultValue;
  }
}

function escapeHtml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function generateReport() {
  console.log("=".repeat(60));
  console.log("Daily Report Generator — Starting");
  console.log("=".repeat(60));

  const todayStr = today();
  const dateTitle = formatDate(todayStr);

  const rankingsDir = path.join(DATA_DIR, "rankings");
  const analysisDir = path.join(DATA_DIR, "analysis");
  const changesDir = path.join(DATA_DIR, "changes");
  const auditsDir = path.join(DATA_DIR, "audits");

  const startTime = Date.now();

  const [rankings, analysis, changes, audits] = await Promise.all([
    readDirFiles(rankingsDir, (name) => todayPattern(name, todayStr)),
    readDirFiles(analysisDir, (name) => todayPattern(name, todayStr)),
    readDirFiles(changesDir, (name) => todayPattern(name, todayStr) || name === "deploy-today.json"),
    readDirFiles(auditsDir, (name) => todayPattern(name, todayStr)),
  ]);

  const readEnd = Date.now();

  const rankingSummary = [];
  for (const r of rankings) {
    if (r.data && r.data.sites) {
      for (const site of r.data.sites) {
        const avgPosition = site.queries && site.queries.length > 0
          ? (site.queries.reduce((s, q) => s + q.position, 0) / site.queries.length).toFixed(1)
          : "N/A";
        const totalClicks = site.queries
          ? site.queries.reduce((s, q) => s + (q.clicks || 0), 0)
          : 0;
        const totalImpressions = site.queries
          ? site.queries.reduce((s, q) => s + (q.impressions || 0), 0)
          : 0;
        rankingSummary.push({ site: site.site, avgPosition, totalClicks, totalImpressions });
      }
    }
  }

  const urgentFixes = [];
  for (const a of analysis) {
    if (a.data && a.data.urgent) {
      urgentFixes.push(...a.data.urgent);
    }
  }

  const changesApplied = [];
  for (const c of changes) {
    if (c.data && c.data.sites) {
      changesApplied.push(...c.data.sites);
    } else if (c.data && c.data.changes) {
      changesApplied.push(...c.data.changes);
    }
  }

  const newContent = [];
  for (const c of changes) {
    if (c.data && c.data.content) {
      newContent.push(...c.data.content);
    }
  }

  const auditIssues = [];
  for (const a of audits) {
    if (a.data && a.data.issues) {
      auditIssues.push(...a.data.issues);
    }
  }

  const totalQueries = rankingSummary.reduce((s, r) => s + r.totalClicks, 0);

  const sections = [];

  sections.push(`# SEO Daily Report - ${dateTitle}`);
  sections.push("");
  sections.push(`> Generated: ${new Date().toISOString()}`);
  sections.push("");

  sections.push("## 📈 Rankings Summary");
  sections.push("");
  if (rankingSummary.length > 0) {
    sections.push("| Site | Avg Position | Total Clicks | Total Impressions |");
    sections.push("|------|-------------|-------------|------------------|");
    for (const r of rankingSummary) {
      sections.push(`| ${r.site} | ${r.avgPosition} | ${r.totalClicks} | ${r.totalImpressions} |`);
    }
  } else {
    sections.push("No ranking data available for today.");
  }
  sections.push("");

  sections.push("## ⚡ Urgent Fixes");
  sections.push("");
  if (urgentFixes.length > 0) {
    for (const fix of urgentFixes) {
      const desc = typeof fix === "string" ? fix : fix.description || fix.issue || JSON.stringify(fix);
      sections.push(`- ${desc}`);
    }
  } else if (auditIssues.length > 0) {
    for (const issue of auditIssues) {
      const desc = typeof issue === "string" ? issue : issue.description || issue.issue || JSON.stringify(issue);
      sections.push(`- ${desc}`);
    }
  } else {
    sections.push("No urgent fixes identified today.");
  }
  sections.push("");

  sections.push("## 🔧 Changes Applied Today");
  sections.push("");
  if (changesApplied.length > 0) {
    for (const c of changesApplied) {
      const name = c.name || c.site || "Unknown";
      const files = c.filesChanged || c.files || 0;
      const status = c.success !== false ? "✅" : "❌";
      sections.push(`- ${status} **${name}**: ${files} file(s) changed`);
    }
  } else {
    sections.push("No changes were applied today.");
  }
  sections.push("");

  sections.push("## 📝 New Content Published");
  sections.push("");
  if (newContent.length > 0) {
    for (const content of newContent) {
      const title = content.title || content.page || "Untitled";
      const url = content.url || "";
      sections.push(`- [${title}](${url})`);
    }
  } else {
    sections.push("No new content was published today.");
  }
  sections.push("");

  sections.push("## 🎯 Tomorrow's Priority Targets");
  sections.push("");
  const priorityAnalysis = analysis.find(a => a.name && a.name.includes("priority"));
  if (priorityAnalysis && priorityAnalysis.data && priorityAnalysis.data.targets) {
    for (const target of priorityAnalysis.data.targets) {
      sections.push(`- ${target.keyword || target.query || target.target} (priority: ${target.priority || "medium"})`);
    }
  } else {
    sections.push("Review keyword rankings and identify underperforming pages for optimization.");
  }
  sections.push("");

  const readTime = readEnd - startTime;
  const genEnd = Date.now();
  const genTime = genEnd - readEnd;
  const totalTime = genEnd - startTime;

  sections.push("## ⏱️ Execution Stats");
  sections.push("");
  sections.push("| Step | Duration |");
  sections.push("|------|----------|");
  sections.push(`| Data Read | ${readTime}ms |`);
  sections.push(`| Report Generation | ${genTime}ms |`);
  sections.push(`| **Total** | **${totalTime}ms** |`);
  sections.push("");

  const report = sections.join("\n");

  const mdFile = path.join(REPORTS_DIR, `report-${todayStr}.md`);
  await ensureDir(REPORTS_DIR);
  await fs.writeFile(mdFile, report, "utf-8");
  console.log(`Saved markdown report to ${mdFile}`);

  const html = generateHtmlReport(report, dateTitle);
  const htmlFile = path.join(REPORTS_DIR, `report-${todayStr}.html`);
  await fs.writeFile(htmlFile, html, "utf-8");
  console.log(`Saved HTML report to ${htmlFile}`);

  const lines = report.split("\n").slice(0, 20);
  console.log("\n--- Report Preview (first 20 lines) ---");
  for (const line of lines) {
    console.log(line);
  }

  console.log("\n" + "=".repeat(60));
  console.log("Report Generation Complete");
  console.log("=".repeat(60));
  console.log(`Markdown: ${mdFile}`);
  console.log(`HTML:     ${htmlFile}`);

  return { mdFile, htmlFile, report };
}

function generateHtmlReport(markdown, title) {
  const bodyLines = [];
  let inTable = false;

  for (const line of markdown.split("\n")) {
    let processed = escapeHtml(line);

    if (processed.startsWith("# ")) {
      bodyLines.push(`<h1>${processed.slice(2)}</h1>`);
    } else if (processed.startsWith("## ")) {
      bodyLines.push(`<h2>${processed.slice(3)}</h2>`);
    } else if (processed.startsWith("### ")) {
      bodyLines.push(`<h3>${processed.slice(4)}</h3>`);
    } else if (processed.startsWith("| ")) {
      if (!inTable) {
        bodyLines.push('<table>');
        inTable = true;
      }
      const cells = processed.split("|").filter(c => c.trim());
      if (cells.every(c => c.trim() === "---" || c.trim() === "------")) {
        continue;
      }
      bodyLines.push(`<tr>${cells.map(c => `<td>${c.trim()}</td>`).join("")}</tr>`);
    } else {
      if (inTable) {
        bodyLines.push('</table>');
        inTable = false;
      }
      if (processed.startsWith("- ")) {
        bodyLines.push(`<li>${processed.slice(2)}</li>`);
      } else if (processed.startsWith("> ")) {
        bodyLines.push(`<blockquote>${processed.slice(2)}</blockquote>`);
      } else if (processed.startsWith("**")) {
        bodyLines.push(`<p><strong>${processed.replace(/\*\*/g, "")}</strong></p>`);
      } else if (processed.trim() === "") {
        bodyLines.push("<br>");
      } else {
        bodyLines.push(`<p>${processed}</p>`);
      }
    }
  }

  if (inTable) bodyLines.push('</table>');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SEO Daily Report - ${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; color: #333; padding: 20px; line-height: 1.6; }
    .container { max-width: 860px; margin: 0 auto; background: #fff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); padding: 32px; }
    h1 { font-size: 1.8em; margin-bottom: 8px; color: #1a1a2e; }
    h2 { font-size: 1.3em; margin: 24px 0 8px; color: #16213e; border-bottom: 2px solid #e0e0e0; padding-bottom: 4px; }
    h3 { font-size: 1.1em; margin: 16px 0 4px; color: #0f3460; }
    p { margin: 8px 0; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; }
    th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
    th { background: #1a1a2e; color: #fff; }
    tr:nth-child(even) { background: #f9f9f9; }
    li { margin: 4px 0 4px 20px; }
    blockquote { border-left: 4px solid #0f3460; padding: 8px 16px; margin: 12px 0; background: #f0f4ff; }
    br { margin: 4px 0; }
    .meta { color: #666; font-size: 0.9em; margin-bottom: 16px; }
  </style>
</head>
<body>
  <div class="container">
    ${bodyLines.join("\n    ")}
  </div>
</body>
</html>`;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  generateReport().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}

export { generateReport };
