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

async function deployToAws(siteName) {
  const awsKey = process.env.AWS_ACCESS_KEY_ID;
  const awsSecret = process.env.AWS_SECRET_ACCESS_KEY;
  const bucket = siteName === "gotripmate"
    ? process.env.S3_BUCKET_GTM
    : process.env.S3_BUCKET_VA;
  const distId = siteName === "gotripmate"
    ? process.env.CLOUDFRONT_DIST_ID_GTM
    : process.env.CLOUDFRONT_DIST_ID_VA;

  if (!awsKey || !awsSecret) throw new Error("AWS credentials not set");
  if (!bucket) throw new Error(`S3_BUCKET not set for ${siteName}`);
  if (!distId) throw new Error(`CLOUDFRONT_DIST_ID not set for ${siteName}`);

  const siteDist = path.join(DIST_DIR, siteName);

  const env = { ...process.env, AWS_ACCESS_KEY_ID: awsKey, AWS_SECRET_ACCESS_KEY: awsSecret };

  const s3SyncCmd = `aws s3 sync "${siteDist}" "s3://${bucket}" --delete --region eu-west-1`;
  console.log(`  Syncing to s3://${bucket}...`);
  execSync(s3SyncCmd, { encoding: "utf-8", timeout: 120000, env, stdio: "inherit" });

  const invalidationCmd = `aws cloudfront create-invalidation --distribution-id "${distId}" --paths "/*" --region eu-west-1`;
  console.log(`  Invalidating CloudFront ${distId}...`);
  const invalidationOut = execSync(invalidationCmd, { encoding: "utf-8", timeout: 60000, env });
  const invalidationResult = JSON.parse(invalidationOut);
  const invalidationId = invalidationResult.Invalidation?.Id || "";

  return { invalidationId, bucket, distId, success: true };
}

async function deployAws() {
  console.log("=".repeat(60));
  console.log("AWS S3 Deploy — Starting");
  console.log("=".repeat(60));

  const changeFiles = findChangesDir(DATA_CHANGES);
  if (changeFiles.length === 0) {
    console.log("No changes to deploy");
    process.exit(0);
  }

  const sites = [
    { name: "gotripmate", url: "https://gotripmate.com" },
    { name: "voyageally", url: "https://voyageally.com" },
  ];

  const deployResults = [];
  let totalFilesChanged = 0;

  for (const site of sites) {
    console.log(`\n--- ${site.name} (${site.url}) ---`);

    const siteChanges = changeFiles.filter(f => f.includes(site.name));
    const filesChanged = siteChanges.length;

    if (filesChanged === 0) {
      console.log(`  No changes for ${site.name}, skipping deploy`);
      continue;
    }

    try {
      const copied = await buildSite(site.name);
      console.log(`  Built ${copied} files to dist/${site.name}`);

      const result = await deployToAws(site.name);
      totalFilesChanged += filesChanged;

      deployResults.push({
        name: site.name,
        url: site.url,
        filesChanged,
        invalidationId: result.invalidationId,
        success: true,
      });

      console.log(`  Deployed to s3://${result.bucket} (CF invalidation: ${result.invalidationId})`);
    } catch (err) {
      console.error(`  Deploy failed for ${site.name}:`, err.message);
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
  console.log("AWS S3/CLOUDFRONT DEPLOY");
  console.log("=".repeat(60));
  for (const r of deployResults) {
    const icon = r.success ? "" : "";
    console.log(`${r.name}: ${icon} ${r.success ? "Deployed" : "Failed"} (${r.url}) - ${r.filesChanged} file(s) changed`);
  }

  const deployRecord = {
    date: today(),
    timestamp: new Date().toISOString(),
    sites: deployResults,
    totalFilesChanged,
  };

  const deployFile = path.join(DATA_CHANGES, "deploy-aws-today.json");
  await writeJson(deployFile, deployRecord);
  console.log(`\nSaved deploy record to ${deployFile}`);

  return deployRecord;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  deployAws().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}

export { deployAws };
