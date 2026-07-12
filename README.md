# Daily SEO Auto-Optimization Loop

Automated daily SEO improvement system for **GoTripMate** (`gotripmate.com`) and **VoyageAlly** (`voyageally.com`). Runs every morning via GitHub Actions — scans, analyzes, optimizes, and auto-publishes SEO improvements. **Zero API costs.**

## How It Works

```
6:00 AM UTC — GitHub Actions triggers
     │
     ▼
┌─────────────┐     ┌──────────────┐     ┌───────────────┐     ┌──────────────┐
│ 1. SCAN     │────→│ 2. ANALYZE   │────→│ 3. OPTIMIZE   │────→│ 4. PUBLISH   │
│             │     │              │     │               │     │              │
│ - Rankings  │     │ - Ranking ∆  │     │ - Rewrite     │     │ - Deploy to  │
│ - Technical │     │ - Content    │     │   meta tags   │     │   Netlify    │
│ - Broken    │     │   gaps       │     │ - Add internal│     │ - Save       │
│   links     │     │ - Priority   │     │   links       │     │   report     │
└─────────────┘     └──────────────┘     │ - Generate    │     └──────────────┘
                                         │   blog post   │
                                         └──────────────┘
```

## What It Does Daily

| Output | Description |
|--------|-------------|
| 📈 **Ranking Report** | Tracks keyword positions, detects winners/losers |
| 🔧 **Technical Fixes** | Checks meta tags, schemas, robots.txt, sitemap, SSL, page speed |
| 🔗 **Broken Link Scan** | Crawls homepage + sitemap, reports all 4xx/5xx |
| 📝 **Meta Rewrites** | Improves title tags & meta descriptions for low-CTR pages |
| 🔗 **Internal Links** | Adds contextual links between related posts + cross-brand |
| 📄 **New Blog Post** | Generates 1 SEO-optimized post from templates |
| 🚀 **Auto-Deploy** | Deploys all changes to Netlify automatically |
| 📋 **Daily Report** | Full report saved to `reports/daily/` |

## Setup Guide

### Step 1: Create GitHub Repository

```bash
# Create a new repo on GitHub called "seo-auto-optimizer"
# Then clone it and add these files
```

### Step 2: Google Cloud Setup (One-Time — 15 min)

Run the setup wizard (from the repo root):

```bash
node scripts/setup-gsc-auth.js
```

This script will guide you through:
1. Creating a Google Cloud project
2. Enabling the Search Console API
3. Creating a service account
4. Downloading the JSON key
5. Testing the connection

**Manual steps if script can't auto-run:**

1. Go to https://console.cloud.google.com/
2. Create a new project (e.g., "seo-optimizer")
3. Enable the **Google Search Console API**
4. Go to **IAM & Admin → Service Accounts**
5. Create a service account named "seo-automator"
6. Download the JSON key
7. Go to https://search.google.com/search-console/
8. Add the service account email as an owner for both `gotripmate.com` and `voyageally.com`

### Step 3: Netlify Setup (One-Time — 5 min)

1. Go to https://app.netlify.com/user/applications → Generate a **Personal Access Token**
2. Go to your site dashboard → **Site Settings → Site Information** → Copy **Site ID** for both sites

### Step 4: Add GitHub Secrets

Go to your repo → **Settings → Secrets and variables → Actions** → Add these 7 secrets:

| Secret | Value | Where to get it |
|--------|-------|----------------|
| `GSC_CLIENT_EMAIL` | `seo-automator@your-project.iam.gserviceaccount.com` | Service account JSON |
| `GSC_PRIVATE_KEY` | Private key (entire value, including header/footer) | Service account JSON |
| `GSC_SITE_URL_GTM` | `https://gotripmate.com` | Your domain |
| `GSC_SITE_URL_VA` | `https://voyageally.com` | Your domain |
| `NETLIFY_AUTH_TOKEN` | `nfp_xxxxxxxxxxxx` | Netlify PAT |
| `NETLIFY_SITE_ID_GTM` | Site ID for gotripmate.com | Netlify dashboard |
| `NETLIFY_SITE_ID_VA` | Site ID for voyageally.com | Netlify dashboard |

### Step 5: Push and Verify

```bash
git add .
git commit -m "Initial SEO auto-optimizer"
git push origin main
```

The workflow will run automatically at 6 AM UTC tomorrow. To test it immediately:

1. Go to your repo → **Actions** tab
2. Select **Daily SEO Loop** workflow
3. Click **Run workflow**

## Project Structure

```
marketing-seo-loop/
├── .github/workflows/
│   └── daily-seo-loop.yml       # GitHub Actions workflow
├── src/
│   ├── scan/
│   │   ├── gsc.js               # Rankings from Google Search Console
│   │   ├── technical.js          # Technical SEO audit
│   │   └── broken-links.js      # Broken link checker
│   ├── analyze/
│   │   ├── ranking-delta.js     # Day-over-day ranking changes
│   │   ├── content-gap.js       # Keyword/content opportunity detection
│   │   └── priority.js          # Prioritized action list
│   ├── optimize/
│   │   ├── meta-rewriter.js     # Title & description optimization
│   │   ├── internal-linker.js   # Internal link suggestions
│   │   └── blog-generator.js    # Blog post generation from templates
│   └── publish/
│       ├── deploy-netlify.js    # Auto-deploy to Netlify
│       └── report.js            # Daily markdown report
├── data/
│   ├── keywords.json            # Target keyword database (50+)
│   ├── competitors.json         # Competitor list
│   ├── content-templates/       # Blog post templates (4 types)
│   │   ├── destination-guide.md
│   │   ├── app-comparison.md
│   │   ├── how-to-guide.md
│   │   └── safety-tips.md
│   ├── rankings/                # Auto-generated ranking snapshots
│   ├── analysis/                # Auto-generated analysis
│   ├── audits/                  # Auto-generated audit results
│   ├── changes/                 # Auto-generated change logs
│   └── generated-posts/         # Auto-generated blog posts
├── scripts/
│   └── setup-gsc-auth.js        # GSC authentication wizard
├── reports/
│   └── daily/                   # Auto-generated daily reports
├── package.json
└── README.md
```

## Local Development

```bash
# Install dependencies
npm install

# Set up GSC auth
node scripts/setup-gsc-auth.js

# Create .env file with:
GSC_CLIENT_EMAIL=your@service.account.com
GSC_PRIVATE_KEY="your-private-key"
GSC_SITE_URL_GTM=https://gotripmate.com
GSC_SITE_URL_VA=https://voyageally.com

# Run individual steps
npm run scan
npm run analyze
npm run optimize
npm run publish

# Or run everything
npm run full-run
```

## Expected Timeline

| Month | Expected Outcome |
|-------|-----------------|
| Month 1 | Technical fixes deployed, all pages indexed |
| Month 2 | First ranking improvements, content strategy active |
| Month 3 | Multiple keywords in top 20, daily publishing |
| Month 4-6 | Keywords reaching top 10, consistent authority growth |
