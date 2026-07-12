#!/usr/bin/env node

/**
 * =============================================================================
 *  GSC Authentication Setup Wizard
 * -----------------------------------------------------------------------------
 *  Guides the user through creating a Google Cloud service account, enabling
 *  the Search Console API, and storing credentials in the correct environment
 *  variables.  Finally, it performs a live test by fetching one day of data.
 *
 *  Usage:
 *    node scripts/setup-gsc-auth.js
 *
 *  Prerequisites:
 *    - A Google Cloud Platform project with billing enabled (free tier is fine)
 *    - The `gcloud` CLI installed and authenticated, OR manual web-console
 *      access to console.cloud.google.com
 *    - Node.js >= 20
 * =============================================================================
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { EOL } from "node:os";

// ---------------------------------------------------------------------------
//  Constants
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");

const GCP_CONSOLE_API_URL =
  "https://console.cloud.google.com/apis/library/searchconsole.googleapis.com";

const KEY_SEPARATOR = `${EOL}${EOL}---${EOL}${EOL}`;

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

/** Prompt the user for input (echoed). */
function question(query) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Print a coloured section header. */
function header(text) {
  const line = "=".repeat(Math.min(text.length + 4, 72));
  console.log(`\n\x1b[1;36m${line}\x1b[0m`);
  console.log(`\x1b[1;36m  ${text}  \x1b[0m`);
  console.log(`\x1b[1;36m${line}\x1b[0m\n`);
}

/** Print a success message. */
function success(text) {
  console.log(`\x1b[1;32m✓\x1b[0m ${text}`);
}

/** Print an info message. */
function info(text) {
  console.log(`  \x1b[1;34m→\x1b[0m ${text}`);
}

/** Print a warning message. */
function warn(text) {
  console.log(`  \x1b[1;33m⚠\x1b[0m ${text}`);
}

/** Print an error and exit. */
function fatal(text) {
  console.error(`\n\x1b[1;31m✖ ERROR:\x1b[0m ${text}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
//  Step 1: Welcome & Instructions
// ---------------------------------------------------------------------------

async function step1_welcome() {
  header("Google Search Console API — Setup Wizard");

  console.log(
    "This wizard will help you create a Google Cloud service account," +
      " enable the Search\nConsole API, and verify everything works.\n"
  );

  console.log(
    "You have two options:\n" +
      "  1) Use the `gcloud` CLI (fastest if already installed)\n" +
      "  2) Use the Google Cloud web console\n"
  );

  const hasGcloud = await detectGcloud();
  return hasGcloud;
}

async function detectGcloud() {
  try {
    const { execSync } = await import("node:child_process");
    const out = execSync("gcloud --version", { encoding: "utf8" });
    const version = out.split("\n")[0];
    info(`Detected ${version}`);
    return true;
  } catch {
    info("gcloud CLI not detected — will provide web-console instructions.");
    return false;
  }
}

// ---------------------------------------------------------------------------
//  Step 2: Create Service Account
// ---------------------------------------------------------------------------

async function step2_create_service_account(useGcloud) {
  header("Step 1 — Create a Google Cloud Service Account");

  const projectId = await question(
    "Enter your Google Cloud Project ID (e.g. my-seo-project): "
  );
  if (!projectId) fatal("Project ID is required.");

  const saName = "seo-automator";
  const saEmail = `${saName}@${projectId}.iam.gserviceaccount.com`;

  if (useGcloud) {
    info(`Creating service account "${saName}" in project "${projectId}"...`);
    try {
      const { execSync } = await import("node:child_process");
      execSync(
        `gcloud iam service-accounts create ${saName} ` +
          `--project="${projectId}" ` +
          `--display-name="SEO Automator Service Account"`,
        { stdio: "inherit" }
      );
      success(`Service account created: ${saEmail}`);
    } catch (err) {
      // Might already exist — that's okay.
      if (err.message.includes("already exists")) {
        warn(`Service account "${saName}" already exists — reusing.`);
      } else {
        fatal(
          `Could not create service account.\n` +
            `  ${err.message}\n\n` +
            `Create it manually at:\n` +
            `  https://console.cloud.google.com/iam-admin/serviceaccounts?project=${projectId}`
        );
      }
    }
  } else {
    console.log(
      `\nPlease create a service account manually:\n\n` +
        `  1. Open: https://console.cloud.google.com/iam-admin/serviceaccounts?project=${projectId}\n` +
        `  2. Click  + Create Service Account\n` +
        `  3. Name:  "seo-automator"\n` +
        `  4. Click  Done (no roles needed at this stage)\n` +
        `  5. After creation, click the service account email,\n` +
        `     go to the  Keys  tab, and click  Add Key → Create New Key.\n` +
        `     Choose  JSON  and save the file.\n`
    );
    const answer = await question(
      "Press Enter once you have created the service account and downloaded the JSON key..."
    );
    console.log("");
  }

  return { projectId, saEmail };
}

// ---------------------------------------------------------------------------
//  Step 3: Enable Search Console API
// ---------------------------------------------------------------------------

async function step3_enable_api(useGcloud, projectId) {
  header("Step 2 — Enable the Google Search Console API");

  if (useGcloud) {
    info(`Enabling searchconsole.googleapis.com for project "${projectId}"...`);
    try {
      const { execSync } = await import("node:child_process");
      execSync(
        `gcloud services enable searchconsole.googleapis.com --project="${projectId}"`,
        { stdio: "inherit" }
      );
      success("Search Console API enabled.");
    } catch (err) {
      fatal(
        `Could not enable the API.\n` +
          `  ${err.message}\n\n` +
          `Enable it manually at:\n` +
          `  ${GCP_CONSOLE_API_URL}?project=${projectId}`
      );
    }
  } else {
    console.log(
      `Enable the Search Console API manually:\n\n` +
        `  1. Open: ${GCP_CONSOLE_API_URL}?project=${projectId}\n` +
        `  2. Click  Enable\n`
    );
    await question("Press Enter once the API is enabled...");
    console.log("");
  }

  success("Search Console API is enabled.");
}

// ---------------------------------------------------------------------------
//  Step 4: Verify / Load the service-account key
// ---------------------------------------------------------------------------

async function step4_load_key() {
  header("Step 3 — Load Your Service Account Key");

  const keyPath = await question(
    "Enter the full path to the downloaded JSON key file\n" +
      "  (drag & drop the file here, then press Enter): "
  );

  const resolvedPath = keyPath.replace(/^['"]|['"]$/g, ""); // strip quotes
  if (!resolvedPath) fatal("No path provided.");

  let keyData;
  try {
    keyData = JSON.parse(readFileSync(resolvedPath, "utf8"));
  } catch (err) {
    fatal(
      `Could not read or parse the key file at:\n` +
        `  ${resolvedPath}\n` +
        `  ${err.message}`
    );
  }

  // Validate required fields
  const requiredFields = [
    "type",
    "project_id",
    "private_key_id",
    "private_key",
    "client_email",
    "client_id",
    "auth_uri",
    "token_uri",
  ];
  for (const field of requiredFields) {
    if (!keyData[field]) {
      fatal(`Key file is missing required field "${field}".`);
    }
  }

  if (keyData.type !== "service_account") {
    fatal(
      `Expected type "service_account" but got "${keyData.type}".` +
        `\nDid you download the right key type?`
    );
  }

  success(`Key file is valid (service account: ${keyData.client_email})`);
  info(`Project:      ${keyData.project_id}`);
  info(`Key ID:       ${keyData.private_key_id.slice(0, 20)}...`);

  return keyData;
}

// ---------------------------------------------------------------------------
//  Step 5: Write .env file (for local development)
// ---------------------------------------------------------------------------

async function step5_write_env(keyData) {
  header("Step 4 — Store Credentials Locally");

  const envPath = resolve(PROJECT_ROOT, ".env");

  // .env.example
  const envExamplePath = resolve(PROJECT_ROOT, ".env.example");
  if (!existsSync(envExamplePath)) {
    const example = `# ── Google Search Console ──────────────────────────────────────────
GSC_CLIENT_EMAIL=your-service-account@project.iam.gserviceaccount.com
GSC_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n"
GSC_SITE_URL_GTM=https://growtheum.com
GSC_SITE_URL_VA=https://vanceanalytics.com

# ── Netlify ────────────────────────────────────────────────────────────
NETLIFY_AUTH_TOKEN=your-netlify-personal-access-token
NETLIFY_SITE_ID_GTM=site-id-for-growtheum
NETLIFY_SITE_ID_VA=site-id-for-vanceanalytics
`;
    writeFileSync(envExamplePath, example, "utf8");
    success("Created .env.example (safe to commit).");
  }

  const answer = await question(
    "\nWrite .env file for local development? (Y/n): "
  );
  if (answer.toLowerCase() === "n") {
    info("Skipped writing .env.  You can create it manually later.");
    return;
  }

  const gtmUrl =
    (await question("GSC Site URL for growtheum.com (e.g. sc_domain:https://growtheum.com): ")) ||
    "sc_domain:https://growtheum.com";

  const vaUrl =
    (await question("GSC Site URL for vanceanalytics.com: ")) ||
    "sc_domain:https://vanceanalytics.com";

  // Build the private key into a single line that Node.js can parse
  // when loaded from dotenv / GitHub Secrets (replace literal \n).
  const privateKeyOneLine = keyData.private_key
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "");

  const envContent = `# ── Google Search Console ──────────────────────────────────────────
GSC_CLIENT_EMAIL=${keyData.client_email}
GSC_PRIVATE_KEY="${privateKeyOneLine}"
GSC_SITE_URL_GTM=${gtmUrl}
GSC_SITE_URL_VA=${vaUrl}

# ── Netlify ────────────────────────────────────────────────────────────
NETLIFY_AUTH_TOKEN=
NETLIFY_SITE_ID_GTM=
NETLIFY_SITE_ID_VA=
`;

  writeFileSync(envPath, envContent, "utf8");
  success(`Created ${envPath}`);
  warn("This file contains secrets.  Make sure .env is listed in .gitignore!");

  // Ensure .gitignore contains .env
  const gitignorePath = resolve(PROJECT_ROOT, ".gitignore");
  if (existsSync(gitignorePath)) {
    const gitignore = readFileSync(gitignorePath, "utf8");
    if (!gitignore.includes(".env")) {
      writeFileSync(gitignorePath, gitignore + "\n.env\n", "utf8");
      success("Added .env to .gitignore");
    }
  } else {
    writeFileSync(gitignorePath, ".env\n", "utf8");
    success("Created .gitignore with .env entry");
  }
}

// ---------------------------------------------------------------------------
//  Step 6: Test the connection
// ---------------------------------------------------------------------------

async function step6_test_connection(keyData) {
  header("Step 5 — Test GSC Connection");

  const answer = await question(
    "Run a live test by fetching 1 day of data? (Y/n): "
  );
  if (answer.toLowerCase() === "n") {
    info("Skipped live test.");
    return;
  }

  const siteUrl =
    (await question(
      "Which site to test? (1) growtheum.com  (2) vanceanalytics.com [1]: "
    )) || "1";
  const scSiteUrl =
    siteUrl === "2"
      ? "sc_domain:https://vanceanalytics.com"
      : "sc_domain:https://growtheum.com";

  info(`Testing connection for: ${scSiteUrl}`);

  try {
    const { default: fetch } = await import("node-fetch");

    // Use the Google OAuth2 token endpoint to get an access token
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: await createJwtAssertion(keyData),
      }),
    });

    if (!tokenResponse.ok) {
      const errBody = await tokenResponse.text();
      fatal(
        `Failed to obtain access token.\n` +
          `  HTTP ${tokenResponse.status}: ${errBody}\n\n` +
          `Check that:\n` +
          `  - The service account exists in your GCP project\n` +
          `  - The Search Console API is enabled\n` +
          `  - The system clock is correct (JWT is time-sensitive)`
      );
    }

    const { access_token } = await tokenResponse.json();

    // Fetch yesterday's data
    const yesterday = new Date(Date.now() - 86400000)
      .toISOString()
      .slice(0, 10);

    const gscResponse = await fetch(
      `https://searchconsole.googleapis.com/v1/sites/${encodeURIComponent(scSiteUrl)}/searchAnalytics/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate: yesterday,
          endDate: yesterday,
          dimensions: ["query", "page"],
          rowLimit: 5,
        }),
      }
    );

    if (!gscResponse.ok) {
      const errBody = await gscResponse.text();
      const errJson = tryParseJson(errBody);

      if (errJson?.error?.message?.includes("not found in Search Console")) {
        fatal(
          `Site "${scSiteUrl}" has not been added to your Search Console account.\n` +
            `  Go to https://search.google.com/search-console and add the property.\n` +
            `  Make sure the property URL matches exactly (with or without "sc_domain:" prefix).`
        );
      }

      fatal(
        `GSC API returned an error.\n` +
          `  HTTP ${gscResponse.status}: ${errBody}`
      );
    }

    const data = await gscResponse.json();
    const rowCount = data.rows?.length ?? 0;

    if (rowCount === 0) {
      warn(
        `Connection works but no data was returned for ${yesterday}.\n` +
          `  This is expected for a brand-new site or if yesterday had no impressions.`
      );
    } else {
      success(
        `Connection successful!  ${rowCount} row(s) returned for ${yesterday}.`
      );
      console.log("");
      for (const row of data.rows) {
        console.log(
          `  ${(row.query ?? "(not provided)").padEnd(40)} ` +
            `imp:${String(row.impressions).padStart(6)} ` +
            `clicks:${String(row.clicks).padStart(4)} ` +
            `pos:${row.position.toFixed(1)}`
        );
      }
    }
  } catch (err) {
    if (err.message?.includes("connect") || err.message?.includes("ENOTFOUND")) {
      fatal(
        `Network error — could not reach Google APIs.\n` +
          `  ${err.message}\n\n` +
          `Check your internet connection and try again.`
      );
    }
    fatal(`Unexpected error during test: ${err.message}`);
  }

  console.log("");
  success("GSC authentication is fully working.\n");
}

// ---------------------------------------------------------------------------
//  Helper: Create a JWT assertion for the service account
// ---------------------------------------------------------------------------

async function createJwtAssertion(keyData) {
  // We need the `jose` library or a simple JWT implementation.
  // For minimal dependencies, we'll use Node's built-in crypto.
  const { createPrivateKey, sign } = await import("node:crypto");

  const header = {
    alg: "RS256",
    typ: "JWT",
    kid: keyData.private_key_id,
  };

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: keyData.client_email,
    scope: "https://www.googleapis.com/auth/webmasters.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const base64UrlEncode = (data) =>
    Buffer.from(JSON.stringify(data))
      .toString("base64url")
      .replace(/=+$/, "");

  const message = `${base64UrlEncode(header)}.${base64UrlEncode(payload)}`;

  const privateKey = createPrivateKey({
    key: keyData.private_key,
    format: "pem",
    passphrase: "", // service-account keys never have a passphrase
  });

  const signature = sign("sha256", Buffer.from(message), privateKey);
  const signatureB64 = signature
    .toString("base64url")
    .replace(/=+$/, "");

  return `${message}.${signatureB64}`;
}

// ---------------------------------------------------------------------------
//  Helper: try to parse a JSON string safely
// ---------------------------------------------------------------------------

function tryParseJson(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
//  Step 7: GitHub Secrets instructions
// ---------------------------------------------------------------------------

async function step7_github_secrets(keyData) {
  header("Step 6 — Configure GitHub Secrets");

  console.log(
    "Add the following secrets to your GitHub repository:\n\n" +
      "  Settings → Secrets and variables → Actions → New repository secret\n"
  );

  const secrets = [
    {
      name: "GSC_CLIENT_EMAIL",
      value: keyData.client_email,
    },
    {
      name: "GSC_PRIVATE_KEY",
      value: `(the entire private_key value from the JSON — including -----BEGIN PRIVATE KEY-----)`,
    },
    {
      name: "GSC_SITE_URL_GTM",
      value: "sc_domain:https://growtheum.com  (or your actual property URL)",
    },
    {
      name: "GSC_SITE_URL_VA",
      value: "sc_domain:https://vanceanalytics.com  (or your actual property URL)",
    },
    {
      name: "NETLIFY_AUTH_TOKEN",
      value: "(your Netlify personal access token)",
    },
    {
      name: "NETLIFY_SITE_ID_GTM",
      value: "(your Netlify site ID for growtheum.com)",
    },
    {
      name: "NETLIFY_SITE_ID_VA",
      value: "(your Netlify site ID for vanceanalytics.com)",
    },
  ];

  for (const s of secrets) {
    console.log(`  ┌─────────────────────────────────────────────────────────┐`);
    console.log(`  │  ${s.name.padEnd(53)}│`);
    console.log(`  ├─────────────────────────────────────────────────────────┤`);
    // Word-wrap the value for readability
    const wrapped = wrapText(s.value, 53);
    for (const line of wrapped) {
      console.log(`  │  ${line.padEnd(53)}│`);
    }
    console.log(`  └─────────────────────────────────────────────────────────┘\n`);
  }
}

function wrapText(text, maxLen) {
  const lines = [];
  while (text.length > 0) {
    lines.push(text.slice(0, maxLen));
    text = text.slice(maxLen);
  }
  return lines.length ? lines : [""];
}

// ---------------------------------------------------------------------------
//  Main
// ---------------------------------------------------------------------------

async function main() {
  console.clear();

  try {
    const useGcloud = await step1_welcome();
    const { projectId } = await step2_create_service_account(useGcloud);
    await step3_enable_api(useGcloud, projectId);
    const keyData = await step4_load_key();
    await step5_write_env(keyData);
    await step6_test_connection(keyData);
    await step7_github_secrets(keyData);

    header("Setup Complete");

    console.log(
      "Your Google Search Console credentials are configured and tested.\n\n" +
        "Next steps:\n" +
        "  1. Add the GitHub secrets listed above to your repository.\n" +
        "  2. Add your Netlify auth token and site IDs as secrets.\n" +
        "  3. The daily workflow will run automatically at 6 AM UTC.\n" +
        "  4. You can also trigger it manually from the Actions tab.\n\n" +
        "  ── Happy optimising! 🚀\n"
    );

    process.exit(0);
  } catch (err) {
    console.error(`\n\x1b[1;31m✖ Setup aborted:\x1b[0m ${err.message}`);
    process.exit(1);
  }
}

main();
