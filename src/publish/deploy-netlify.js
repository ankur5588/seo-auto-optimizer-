import { promises as fs, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const DATA_CHANGES = path.join(PROJECT_ROOT, "data", "changes");
const GOTRIPMATE_SITE = path.resolve(PROJECT_ROOT, "..", "gotripmate-site");
const DIST_DIR = path.join(PROJECT_ROOT, "dist");

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function readJson(filePath, defaultValue = null) {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return defaultValue;
  }
}

async function writeJson(filePath, data) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function findChangesDir(changesDir) {
  const todayStr = today();
  const changes = [];

  try {
    const entries = readdirSync(changesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.startsWith(todayStr) && entry.name.endsWith(".json")) {
        changes.push(path.join(changesDir, entry.name));
      }
    }
  } catch {
    return changes;
  }

  return changes;
}

async function buildSite(siteName) {
  const siteDist = path.join(DIST_DIR, siteName);
  await ensureDir(siteDist);

  const srcDir = GOTRIPMATE_SITE;
  let filesCopied = 0;

  async function copyRecursive(src, dest) {
    await ensureDir(dest);
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await copyRecursive(srcPath, destPath);
      } else if (entry.isFile()) {
        await fs.copyFile(srcPath, destPath);
        filesCopied++;
      }
    }
  }

  await copyRecursive(srcDir, siteDist);
  return filesCopied;
}

async function deployToNetlify(siteId, siteName, siteDist) {
  const authToken = process.env.NETLIFY_AUTH_TOKEN;
  if (!authToken) throw new Error("NETLIFY_AUTH_TOKEN not set");

  const deployCmd = `npx netlify deploy --dir="${siteDist}" --site="${siteId}" --auth="${authToken}" --prod --json`;
  const stdout = execSync(deployCmd, { encoding: "utf-8", timeout: 120000 });
  const result = JSON.parse(stdout);

  const deployUrl = result.deploy_url || result.url || "";
  const deployId = result.deploy_id || "";

  const verifyUrl = deployUrl || `https://${siteName === "gotripmate" ? "gotripmate" : "voyageally"}.com`;
  try {
    const response = await fetch(verifyUrl, { method: "HEAD" });
    if (response.status !== 200) {
      console.warn(`  ⚠️ Verification returned ${response.status} for ${verifyUrl}`);
    }
  } catch {
    console.warn(`  ⚠️ Could not verify ${verifyUrl}`);
  }

  return { deployId, deployUrl, success: true };
}

async function deployNetlify() {
  console.log("=".repeat(60));
  console.log("Netlify Deploy — Starting");
  console.log("=".repeat(60));

  const authToken = process.env.NETLIFY_AUTH_TOKEN;
  const siteIdGtm = process.env.NETLIFY_SITE_ID_GTM;
  const siteIdVa = process.env.NETLIFY_SITE_ID_VA;

  if (!authToken) {
    console.error("Missing NETLIFY_AUTH_TOKEN env var");
    process.exit(1);
  }

  const sites = [
    { name: "gotripmate", siteId: siteIdGtm, url: "https://gotripmate.com" },
    { name: "voyageally", siteId: siteIdVa, url: "https://voyageally.com" },
  ];

  const changeFiles = findChangesDir(DATA_CHANGES);
  if (changeFiles.length === 0) {
    console.log("No changes to deploy");
    process.exit(0);
  }

  const deployResults = [];
  let totalFilesChanged = 0;
  let globalDeployId = "";

  for (const site of sites) {
    if (!site.siteId) {
      console.log(`\n--- ${site.name}: No site ID configured, skipping ---`);
      continue;
    }

    console.log(`\n--- ${site.name} (${site.url}) ---`);

    const siteChanges = changeFiles.filter(f => f.includes(site.name));
    const filesChanged = siteChanges.length;

    if (filesChanged === 0) {
      console.log(`  No changes for ${site.name}, skipping deploy`);
      continue;
    }

    try {
      const siteDist = path.join(DIST_DIR, site.name);
      const copied = await buildSite(site.name);
      console.log(`  Built ${copied} files to ${siteDist}`);

      const result = await deployToNetlify(site.siteId, site.name, siteDist);
      globalDeployId = result.deployId || globalDeployId;
      totalFilesChanged += filesChanged;

      deployResults.push({
        name: site.name,
        url: site.url,
        filesChanged,
        deployUrl: result.deployUrl,
        success: true,
      });

      console.log(`  ✅ Deployed (${result.deployUrl})`);
    } catch (err) {
      console.error(`  ❌ Deploy failed for ${site.name}:`, err.message);
      deployResults.push({
        name: site.name,
        url: site.url,
        filesChanged,
        success: false,
        error: err.message,
      });
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("NETLIFY DEPLOY");
  console.log("=".repeat(60));
  for (const r of deployResults) {
    const icon = r.success ? "✅" : "❌";
    console.log(`${r.name}: ${icon} ${r.success ? "Deployed" : "Failed"} (${r.url}) - ${r.filesChanged} file(s) changed`);
  }
  if (globalDeployId) {
    console.log(`Deploy ID: ${globalDeployId}`);
  }

  const deployRecord = {
    date: today(),
    timestamp: new Date().toISOString(),
    sites: deployResults,
    totalFilesChanged,
    deployId: globalDeployId,
  };

  const deployFile = path.join(DATA_CHANGES, "deploy-today.json");
  await writeJson(deployFile, deployRecord);
  console.log(`\nSaved deploy record to ${deployFile}`);

  return deployRecord;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  deployNetlify().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}

export { deployNetlify };
