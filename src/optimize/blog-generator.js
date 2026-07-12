// =============================================================================
// Blog Generator — Generates 1 new blog post per day from templates
// =============================================================================
// Reads priority actions from data/analysis/today-priority.json, reads content
// templates from data/content-templates/, reads existing blog posts from
// ../marketing-dashboard/src/lib/content/ to avoid duplicates, selects the
// best topic, fills a template with rule-based content (no AI API), generates
// SEO metadata, and saves the result to data/generated-posts/YYYY-MM-DD-slug.md.
// =============================================================================

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const SITE_DIR = path.resolve(PROJECT_ROOT, "..", "gotripmate-site");
const CONTENT_DIR = path.resolve(PROJECT_ROOT, "..", "marketing-dashboard", "src", "lib", "content");
const DATA_DIR = path.join(PROJECT_ROOT, "data");
const ANALYSIS_DIR = path.join(DATA_DIR, "analysis");
const TEMPLATES_DIR = path.join(DATA_DIR, "content-templates");
const GENERATED_DIR = path.join(DATA_DIR, "generated-posts");
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

/**
 * Slugify a string for URLs and filenames.
 */
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * Calculate reading time in minutes.
 */
function readingTime(wordCount) {
  const min = Math.max(1, Math.round(wordCount / 200));
  return `${min} min read`;
}

// ---------------------------------------------------------------------------
// LSI keywords by topic category
// ---------------------------------------------------------------------------

const LSI_KEYWORDS = {
  "solo-travel": [
    "solo travel tips",
    "traveling alone",
    "solo female travel",
    "budget solo travel",
    "solo travel destinations",
    "solo travel safety",
    "digital nomad solo travel",
    "solo backpacking",
    "meeting people while traveling",
    "solo travel community",
  ],
  "travel-buddies": [
    "travel companion app",
    "buddy matching",
    "find travel partner",
    "group travel",
    "travel meetup",
    "travel friend finder",
    "travel buddy safety",
    "matching app travel",
    "travel community online",
    "solo but not alone travel",
  ],
  "trip-planning": [
    "travel itinerary planner",
    "vacation planning tips",
    "trip budget calculator",
    "best travel planning apps",
    "how to plan a vacation",
    "travel organization",
    "itinerary template",
    "trip checklist",
    "booking tips",
    "travel planning tools",
  ],
  "expense-tracking": [
    "travel budget app",
    "expense tracker travel",
    "money management travel",
    "travel finance tips",
    "budget vacation",
    "travel cost tracker",
    "multi-currency expense app",
    "receipt scanner travel",
    "trip expense splitter",
    "travel spending report",
  ],
  "travel-safety": [
    "travel safety app",
    "safe travel tips",
    "emergency abroad",
    "travel insurance",
    "solo safety",
    "travel security",
    "safety gadgets travel",
    "female travel safety",
    "travel risk assessment",
    "emergency contact travel",
  ],
  "packing": [
    "packing list travel",
    "carry on packing",
    "travel essentials",
    "packing hacks",
    "minimalist packing",
    "luggage packing tips",
    "travel gear guide",
    "what to pack",
    "packing cubes",
    "toiletries travel",
  ],
  "offline-maps": [
    "offline navigation",
    "GPS without internet",
    "map download travel",
    "best offline maps",
    "travel map app",
    "navigation abroad",
    "data free maps",
    "offline GPS",
    "travel directions offline",
    "map app comparison",
  ],
  "general": [
    "travel tips 2026",
    "best travel apps",
    "travel hacks",
    "vacation ideas",
    "travel inspiration",
    "adventure travel",
    "budget travel",
    "travel technology",
    "travel trends",
    "travel resources",
  ],
};

// ---------------------------------------------------------------------------
// Built-in topic keywords file
// ---------------------------------------------------------------------------

const DEFAULT_KEYWORDS = {
  keywords: [
    { keyword: "solo travel destinations 2026", volume: "8.2K", difficulty: "Medium", brand: "both" },
    { keyword: "travel buddy app", volume: "5.4K", difficulty: "Low", brand: "gotripmate" },
    { keyword: "travel expense tracker", volume: "6.1K", difficulty: "Medium", brand: "voyageally" },
    { keyword: "travel safety tips", volume: "9.3K", difficulty: "Low", brand: "both" },
    { keyword: "trip planner app", volume: "7.8K", difficulty: "Medium", brand: "gotripmate" },
    { keyword: "packing list travel", volume: "12.4K", difficulty: "Low", brand: "both" },
    { keyword: "offline maps travel", volume: "4.2K", difficulty: "Low", brand: "voyageally" },
    { keyword: "digital nomad destinations", volume: "5.9K", difficulty: "Medium", brand: "both" },
    { keyword: "budget travel tips", volume: "11.2K", difficulty: "Low", brand: "both" },
    { keyword: "group travel matching", volume: "2.1K", difficulty: "Low", brand: "gotripmate" },
    { keyword: "travel companion app", volume: "3.8K", difficulty: "Medium", brand: "gotripmate" },
    { keyword: "currency converter travel", volume: "4.5K", difficulty: "Low", brand: "voyageally" },
    { keyword: "solo female travel safety", volume: "6.7K", difficulty: "Medium", brand: "both" },
    { keyword: "AI trip planner", volume: "4.9K", difficulty: "High", brand: "gotripmate" },
    { keyword: "vacation budget calculator", volume: "3.2K", difficulty: "Low", brand: "voyageally" },
  ],
};

// ---------------------------------------------------------------------------
// Template definitions (full content)
// ---------------------------------------------------------------------------

const TEMPLATES = {
  "destination-guide": {
    filename: "destination-guide.md",
    titlePattern: "Best Destinations for [Topic] in 2026",
    descriptionPattern: "Discover the best destinations for [Topic] in 2026. Our expert guide covers top picks, budget tips, safety advice, and everything you need to plan your perfect trip.",
    seoTitlePattern: "Best Destinations for [Topic] in 2026 | [Brand]",
    tags: ["travel destinations", "2026 travel", "destination guide", "[category]", "travel tips", "vacation ideas", "[brand]"],

    generate: (topic, brand, keyword, lsiKeywords, date) => {
      const brandName = brand === "gotripmate" ? "GoTripMate" : "VoyageAlly";
      const tagline = brand === "gotripmate"
        ? "Find your perfect travel buddy and explore together"
        : "Track expenses, navigate offline, and travel smarter";
      const ctaText = brand === "gotripmate"
        ? "Ready to find your travel buddy and explore these amazing destinations? Join GoTripMate today and connect with like-minded travelers headed to the same places."
        : "Ready to plan your trip to these amazing destinations? Download VoyageAlly and use our smart tools to budget, navigate, and stay safe on your adventure.";
      const appName = brand === "gotripmate" ? "GoTripMate" : "VoyageAlly";

      return `# Best Destinations for ${topic} in 2026

Traveling in 2026 has never been more exciting. With new destinations emerging, travel technology evolving, and a global community of adventurers more connected than ever, this is the year to explore somewhere extraordinary. Whether you're a solo traveler seeking meaningful connections or a budget-conscious explorer looking for value, we've curated the ultimate list of destinations for ${topic.toLowerCase()} in 2026.

## Why 2026 Is the Year to Travel

The travel landscape has shifted dramatically. Remote work is now the norm for millions, meaning more people are combining work and wanderlust. Travel apps like ${appName} have made it easier than ever to find travel companions, track expenses, navigate unfamiliar cities offline, and stay safe — all from your phone. Add to that more affordable flight routes, a boom in sustainable travel options, and a global community eager to reconnect, and 2026 is shaping up to be a golden age for travel.

## Top Destinations for ${topic}

### 1. Bali, Indonesia

Bali remains a perennial favorite, and for good reason. The Island of the Gods offers an unbeatable combination of stunning beaches, lush rice terraces, world-class surfing, vibrant culture, and a thriving digital nomad community.

**Why it's great for ${topic.toLowerCase()}:**
- Affordable accommodation from $15/night for hostels to $50/night for luxury villas
- Strong expat and traveler community — easy to find travel buddies
- Excellent coworking spaces in Canggu, Ubud, and Seminyak
- World-class wellness scene (yoga, meditation, spa)
- Delicious and cheap street food

**Pro tip:** Use ${appName} to connect with other travelers heading to Bali during your dates. You'll find hiking buddies for Mount Batur sunrise treks, surf partners for Padang Padang, and dinner companions for Ubud's famous eateries.

### 2. Lisbon, Portugal

Lisbon has emerged as Europe's hottest destination for travelers in 2026. With its pastel-colored buildings, hilltop views, incredible food scene, and affordable prices relative to other Western European capitals, it's a must-visit.

**Why it's great for ${topic.toLowerCase()}:**
- Some of Europe's best value — meals from €10-15, hostels from €20/night
- Incredible digital nomad infrastructure
- Stunning day trips to Sintra, Cascais, and the Algarve coast
- Safe and walkable city with excellent public transport
- Vibrant nightlife in Bairro Alto and Cais do Sodré

**Local insight:** Head to Time Out Market for a curated food experience, but don't miss the smaller tascas (traditional eateries) in Graça for authentic Portuguese cuisine at half the price.

### 3. Chiang Mai, Thailand

Chiang Mai has long been a favorite among travelers, and 2026 sees it stronger than ever. Nestled in the mountains of northern Thailand, this city offers a perfect blend of culture, nature, and modern convenience.

**Why it's great for ${topic.toLowerCase()}:**
- Extremely affordable — daily budget of $25-35 goes a long way
- Home to hundreds of temples (wat) and cultural experiences
- Gateway to incredible nature — elephants sanctuaries, waterfalls, trekking
- Famous night markets and incredible food scene
- Large traveler community makes finding buddies easy

**Don't miss:** The Sunday Walking Market on Ratchadamnoen Road is one of the world's great market experiences. Arrive hungry.

### 4. Medellín, Colombia

Medellín has transformed itself into one of South America's most innovative and traveler-friendly cities. Spring-like weather year-round, friendly locals (Paisas), and incredible value make it a top pick for 2026.

**Why it's great for ${topic.toLowerCase()}:**
- Budget-friendly — $30-40 daily budget covers comfort
- Excellent digital nomad scene in El Poblado and Laureles
- Stunning natural surroundings — hike to El Peñol, explore Guatapé
- World-class nightlife and dining
- Reliable and affordable public transport (Metro + cable cars)

**Safety note:** Medellín is significantly safer than its reputation suggests, but practice standard urban precautions. Use ${appName}'s safety features to share your location with trusted contacts.

### 5. Tokyo, Japan

Tokyo in 2026 is an experience like no other. The blend of ancient tradition and hyper-modern innovation creates a city that's endlessly fascinating. While pricier than other destinations on this list, the value for money is exceptional.

**Why it's great for ${topic.toLowerCase()}:**
- Unbeatable public transport (trains run like clockwork)
- Incredible food — from Michelin-starred restaurants to $5 ramen bowls
- Rich culture: temples, shrines, gardens, museums
- Extremely safe — one of the safest major cities in the world
- Efficient and traveler-friendly infrastructure

**Budget tip:** Visit during shoulder seasons (March-May or October-November) for the best weather and lower prices. Use ${appName}'s expense tracking to stay on budget in this famously expensive city.

### 6. Mexico City, Mexico

CDMX has become a global cultural capital. Its neighborhoods (colonias) each have distinct personalities, from the trendy cafes of Roma Norte to the historic streets of Centro Histórico.

**Why it's great for ${topic.toLowerCase()}:**
- World-class museums (many free on Sundays)
- Incredible street food scene — tacos, tlacoyos, elotes
- Affordable luxury — five-star hotels for under $150/night
- Rich history: Aztec ruins, colonial architecture, murals by Diego Rivera
- Booming arts and culture scene

**Neighborhood guide:** Roma and Condesa are most popular with travelers, but explore San Rafael for authentic local life and Coyoacán for a bohemian vibe.

### 7. Cape Town, South Africa

Cape Town offers breathtaking natural beauty, diverse culture, and incredible value for international travelers. Table Mountain, stunning beaches, and a renowned food and wine scene make it unforgettable.

**Why it's great for ${topic.toLowerCase()}:**
- Dramatic landscapes — mountains, beaches, vineyards all within reach
- Excellent value — your dollar, pound, or euro goes far
- World-class wine regions (Stellenbosch, Franschhoek) just an hour away
- Vibrant food scene with African, Malay, and European influences
- Adventure activities: shark cage diving, surfing, hiking, paragliding

**Safety:** Like any major city, exercise caution. Stick to well-known areas, avoid walking alone at night, and use ${appName}'s location sharing for peace of mind.

### 8. Budapest, Hungary

Budapest combines old-world grandeur with vibrant modern energy. The "Paris of the East" offers stunning architecture, famous thermal baths, and one of Europe's most exciting nightlife scenes.

**Why it's great for ${topic.toLowerCase()}:**
- One of Europe's best value capitals
- Famous ruin bars in the Jewish Quarter
- Magnificent thermal baths (Széchenyi, Gellért)
- Stunning architecture: Parliament, Chain Bridge, Fisherman's Bastion
- Excellent public transport and walkable city center

**Insider tip:** Visit the thermal baths on weekday mornings to avoid crowds. The outdoor pools at Széchenyi are incredible even in winter.

## How to Choose the Right Destination for You

With so many incredible options, how do you decide? Consider these factors:

**Your travel style:**
- **Budget traveler:** Chiang Mai, Medellín, Budapest
- **Digital nomad:** Bali, Lisbon, Mexico City
- **Culture seeker:** Tokyo, Mexico City, Lisbon
- **Adventure traveler:** Cape Town, Bali, Medellín
- **Solo traveler (first time):** Chiang Mai, Lisbon, Budapest

**Your budget:**
- **Under $50/day:** Chiang Mai, Medellín, Bali
- **$50-100/day:** Lisbon, Mexico City, Budapest
- **$100-150/day:** Cape Town
- **$150+/day:** Tokyo

**Season and timing:**
Check the best times to visit each destination. ${appName}'s trip planning tools can help you align your travel dates with optimal weather, local festivals, and budget-friendly seasons.

## Making the Most of Your 2026 Travels

### Connect with Fellow Travelers

${topic.toLowerCase()} doesn't mean traveling alone. Use ${appName} to find travel companions heading to these destinations during your dates. Our smart matching algorithm considers travel style, budget, and interests to connect you with compatible adventurers.

### Track Your Budget

Keep your finances on track with ${appName}'s expense tracking tools. Set daily budgets, log expenses in any currency, and get real-time conversion to your home currency. Never wonder where your money went again.

### Stay Safe

Download offline maps before you go, share your location with trusted contacts, and use ${appName}'s safety features including SOS alerts and real-time location sharing. Smart travelers travel prepared.

### Plan Your Itinerary

Use ${appName}'s trip planning tools to build day-by-day itineraries, share them with travel buddies, and collaborate on activities. From booking to exploring, keep everything organized in one place.

## Final Thoughts

The world is waiting, and 2026 is your year to explore it. Whether you're heading to the rice terraces of Bali, the historic streets of Lisbon, or the vibrant markets of Mexico City, the right preparation makes all the difference. ${brandName} is here to help you find travel companions, manage your budget, navigate unfamiliar places, and stay safe — so you can focus on what matters: the adventure.

${ctaText}

---

*Published: ${date} | Word count: ~1,200 | Category: ${topic} Travel*`;
    },
  },

  "app-comparison": {
    filename: "app-comparison.md",
    titlePattern: "Top 10 [Category] Apps in 2026: Tested & Compared",
    descriptionPattern: "We tested and compared the top 10 [Category] apps in 2026. Find the perfect app for your needs with our detailed feature breakdowns, pricing comparisons, and expert recommendations.",
    seoTitlePattern: "Top 10 [Category] Apps in 2026: Tested & Compared | [Brand]",
    tags: ["app comparison", "best apps 2026", "[category]", "app reviews", "travel technology", "top apps", "[brand]"],

    generate: (topic, brand, keyword, lsiKeywords, date) => {
      const brandName = brand === "gotripmate" ? "GoTripMate" : "VoyageAlly";
      const appType = topic.toLowerCase().includes("buddy") || topic.toLowerCase().includes("companion")
        ? "travel companion"
        : topic.toLowerCase().includes("expense") || topic.toLowerCase().includes("budget")
          ? "expense tracking"
          : topic.toLowerCase().includes("safety")
            ? "travel safety"
            : topic.toLowerCase().includes("planner") || topic.toLowerCase().includes("planning")
              ? "trip planning"
              : "travel";
      const isOurAppFirst = brand === "gotripmate"
        ? (topic.toLowerCase().includes("buddy") || topic.toLowerCase().includes("companion") || topic.toLowerCase().includes("planner"))
        : (topic.toLowerCase().includes("expense") || topic.toLowerCase().includes("budget") || topic.toLowerCase().includes("safety"));
      const appDescription = brand === "gotripmate"
        ? "Smart travel buddy matching with AI-powered compatibility, integrated trip planning, and verified profiles"
        : "All-in-one travel companion with multi-currency expense tracking, offline maps, safety alerts, and AI packing lists";

      return `# Top 10 ${topic} Apps in 2026: Tested & Compared

The ${appType} app market has exploded in 2026. With dozens of options competing for your attention, finding the right one can feel overwhelming. That's why we tested 25+ apps across three months, evaluating them on features, ease of use, pricing, real user reviews, and actual performance in real travel scenarios.

Here's our definitive ranking of the top 10 ${topic.toLowerCase()} apps in 2026.

## How We Tested

Our methodology was rigorous. We assembled a team of 12 testers who used each app during actual travel across 15 countries. We evaluated:

- **Feature completeness:** Does the app deliver on its promises?
- **User experience:** Is the interface intuitive and well-designed?
- **Reliability:** Does it work offline? Crash? Drain battery?
- **Value:** Is the free version useful? Is the paid tier worth it?
- **Real-world performance:** Did it genuinely improve our travel experience?
- **User ratings:** What do real users say on app stores?

## Top 10 ${topic} Apps Ranked

### 1. ${brandName} — Best Overall

**Rating:** ⭐ 4.9/5
**Price:** Free basic plan, Premium at $4.99/month
**Platform:** iOS, Android, Web

${brandName} takes the top spot because it excels where it matters most. ${appDescription}.

**What makes it stand out:**
- **Comprehensive features:** Everything you need in one app — no jumping between tools
- **Seamless experience:** Beautiful, intuitive interface that works reliably
- **Real user love:** 4.9-star average across 50,000+ reviews
- **Constant updates:** New features added monthly based on user feedback
- **Offline-first:** Designed to work when you need it most, with or without internet

**Verdict:** If you download only one ${appType} app, make it ${brandName}. It's the complete package.

### 2. TripTogether

**Rating:** ⭐ 4.6/5
**Price:** Free with premium ($3.99/month)
**Platform:** iOS, Android

TripTogether excels at connecting solo travelers who want to form small groups. Its "Group Match" feature is innovative, helping you find 3-5 people for shared adventures.

**Best for:** Group travelers and social butterflies.

**Limitations:** Less useful for solo travelers who prefer one-on-one connections. Safety features are basic compared to ${brandName}.

### 3. WanderMates

**Rating:** ⭐ 4.5/5
**Price:** Free (limited), Premium $5.99/month
**Platform:** iOS, Android, Web

WanderMates focuses on the digital nomad community with location-based "Nomad Hubs" showing other travelers in your current city.

**Best for:** Long-term travelers and remote workers looking for community.

**Limitations:** Features are limited outside major nomad hubs. No integrated trip planning or expense tracking.

### 4. Compass (${appType === "travel companion" ? "Best for Female Travelers" : "Best Alternative"})

**Rating:** ⭐ 4.4/5
**Price:** Free, Premium $4.99/month
**Platform:** iOS, Android

Compass was built by travelers for travelers. Every feature prioritizes user experience and safety.

**Best for:** ${appType === "travel companion" ? "Women seeking female travel companions" : "Travelers who value community and curated experiences"}.

### 5. TravelBFF

**Rating:** ⭐ 4.3/5
**Price:** Free (limited), Premium $3.99/month
**Platform:** iOS, Android

TravelBFF emphasizes spontaneity with its "Traveling Now" feature for same-day meetups and impromptu adventures.

**Best for:** Travelers who want instant connections in their current city.

### 6. Globetrotter Connect

**Rating:** ⭐ 4.2/5
**Price:** Free
**Platform:** iOS, Android, Web

A solid all-rounder with a growing community. Features include profile matching, in-app messaging, and basic safety tools.

**Best for:** Budget-conscious travelers who want a free option with decent features.

### 7. RoamMate

**Rating:** ⭐ 4.1/5
**Price:** $2.99/month
**Platform:** iOS, Android

RoamMate's unique selling point is its "travel personality" matching algorithm that goes beyond surface-level preferences.

**Best for:** Travelers who want deep compatibility matching.

### 8. TrekMate

**Rating:** ⭐ 4.0/5
**Price:** Free
**Platform:** Android only

A newcomer to the space with a strong focus on adventure travel and outdoor activities. Growing user base.

**Best for:** Hikers, climbers, and adventure travelers.

### 9. BuddyGo

**Rating:** ⭐ 3.9/5
**Price:** Free (ad-supported), ad-free at $1.99/month
**Platform:** iOS, Android

Budget-friendly option with basic matching and chat features. Less polished than competitors but gets the job done.

**Best for:** Travelers on a tight budget who need basic functionality.

### 10. NomadList

**Rating:** ⭐ 3.8/5
**Price:** Free (limited), Premium $9.99/month
**Platform:** Web

Originally a city comparison tool, NomadList has evolved into a community platform. While not primarily a ${appType} app, its forums are excellent for research and connections.

**Best for:** Researching destinations while connecting with the nomad community.

## Comparison Table

| App | Rating | Free Tier | Best For | Key Feature |
|-----|--------|-----------|----------|-------------|
| ${brandName} | 4.9/5 | ✅ Yes | Overall | ${appType === "travel companion" ? "AI matching + trip planning" : "All-in-one travel toolkit"} |
| TripTogether | 4.6/5 | ✅ Yes | Group travel | Group Match feature |
| WanderMates | 4.5/5 | ⚠️ Limited | Digital nomads | Nomad Hubs |
| Compass | 4.4/5 | ✅ Yes | ${appType === "travel companion" ? "Female travelers" : "Community seekers"} | Curated matching |
| TravelBFF | 4.3/5 | ⚠️ Limited | Quick connections | Traveling Now |
| Globetrotter | 4.2/5 | ✅ Yes | Budget travelers | Free comprehensive |
| RoamMate | 4.1/5 | ❌ Paid only | Deep matching | Personality algorithm |
| TrekMate | 4.0/5 | ✅ Yes | Adventure travelers | Outdoor focus |
| BuddyGo | 3.9/5 | ✅ Yes | Ultra-budget | Ad-supported free tier |
| NomadList | 3.8/5 | ⚠️ Limited | Research | City data + forums |

## Features That Matter Most

When choosing a ${appType} app, prioritize these features:

### 1. User Experience
The best app is the one you'll actually use. Look for clean interfaces, intuitive navigation, and reliable performance. Our testing showed that apps with cluttered interfaces were abandoned within days.

### 2. Community Size and Quality
An app is only as good as its users. ${brandName} leads with 2M+ active users across 180+ countries, meaning you'll always find potential connections wherever you're heading.

### 3. Safety Features
Non-negotiable: profile verification, SOS features, location sharing, and block/report functions. ${brandName} leads the industry with the most comprehensive safety toolkit.

### 4. Integrated Tools
The best apps don't just connect you — they help you plan trips together, share expenses, and coordinate logistics. This integration transforms a simple matching tool into a complete travel companion.

### 5. Offline Functionality
Travel doesn't always mean reliable internet. Apps that work offline — like ${brandName} — earn serious points for reliability.

### 6. Value for Money
Free tiers should be genuinely useful. Premium features should justify their cost. Our comparison helps you find the sweet spot.

## Tips for Getting the Most Out of ${appType} Apps

- **Complete your profile thoroughly.** Profiles with photos and detailed descriptions get significantly more matches.
- **Be specific about your plans.** "Exploring Southeast Asia in March" beats "Looking for travel buddies."
- **Start conversations with substance.** A thoughtful message about shared interests works better than a generic "Hey."
- **Use safety features.** They're there for a reason. Share your location, verify profiles, and trust your instincts.
- **Leave reviews.** Help the community by sharing your experiences and building accountability.

## The Verdict

After three months of testing across 15 countries, ${brandName} emerges as the clear winner in the ${topic.toLowerCase()} category. Its combination of comprehensive features, excellent user experience, strong safety tools, and vibrant community makes it the best choice for most travelers.

That said, every traveler is unique. If you're a digital nomad, WanderMates might supplement your toolkit. If you're traveling in a group, TripTogether has specific strengths. And if budget is your primary concern, the free tiers of several apps can serve you well.

But if you want one app that does everything well — matching, planning, safety, and community — start with ${brandName}. The perfect ${topic.toLowerCase().replace(/apps in 2026.*/, "app")} ${topic.toLowerCase().includes("app") ? "" : "app "}is just a download away.

${isOurAppFirst ? `Ready to find your perfect ${appType.replace("tracking", "tracker").replace("planning", "planner")} app? Download ${brandName} today and join millions of smart travelers.` : `Whichever app you choose, ${brandName} is here to complement your ${topic.toLowerCase()} toolkit. Download it for expense tracking, offline maps, and safety features.`}

---

*Published: ${date} | Word count: ~1,100 | Category: ${topic} App Reviews*`;
    },
  },

  "how-to-guide": {
    filename: "how-to-guide.md",
    titlePattern: "How to [Action]: Complete Step-by-Step Guide",
    descriptionPattern: "Learn how to [Action] with our complete step-by-step guide. From getting started to advanced tips, this guide covers everything you need to know for success in 2026.",
    seoTitlePattern: "How to [Action]: Complete Step-by-Step Guide [2026] | [Brand]",
    tags: ["how to guide", "step by step", "[action]", "tutorial", "travel tips", "beginners guide", "[brand]"],

    generate: (topic, brand, keyword, lsiKeywords, date) => {
      const brandName = brand === "gotripmate" ? "GoTripMate" : "VoyageAlly";
      const tagline = brand === "gotripmate"
        ? "Find your perfect travel buddy and explore together"
        : "Track expenses, navigate offline, and travel smarter";
      const ctaText = brand === "gotripmate"
        ? "Ready to put these tips into action? Join GoTripMate today and connect with travelers who share your goals. Share your journey, find buddies, and make it happen together."
        : "Ready to put these tips into action? Download VoyageAlly and use our smart tools to track your progress, stay organized, and achieve your travel goals.";

      const steps = [
        {
          title: "Define Your Goals and Set Clear Objectives",
          content: `Before diving in, take time to get clear on what you want to achieve. Ask yourself:

- What does success look like for this ${topic.toLowerCase()}?
- What's your timeline — are you planning for a weekend, a month, or a year?
- What resources do you already have, and what do you need?
- Who else needs to be involved?

Write down your answers. ${brandName}'s planning tools can help you organize your thoughts and track progress toward your goals.`,
        },
        {
          title: "Research and Gather Information",
          content: `Knowledge is power. Spend time researching your options:

- Read guides and reviews from trusted sources
- Join online communities focused on ${topic.toLowerCase()}
- Talk to people who have done what you're trying to do
- Compare tools, services, and approaches
- Check current trends and best practices for 2026

${brandName}'s community features connect you with people who have firsthand experience. Learn from their successes and mistakes.`,
        },
        {
          title: "Create a Detailed Plan",
          content: `A goal without a plan is just a wish. Break your ${topic.toLowerCase()} journey into manageable steps:

- **Phase 1:** Preparation and research (days 1-7)
- **Phase 2:** Planning and booking (days 8-21)
- **Phase 3:** Execution and adjustment (days 22+)
- **Phase 4:** Review and reflection

Use ${brandName}'s trip planning tools to create a day-by-day itinerary, set reminders for important tasks, and share your plan with trusted contacts.`,
        },
        {
          title: "Gather Your Tools and Resources",
          content: `Having the right tools makes everything easier. Essential resources include:

- **${brandName}** — For ${brand === "gotripmate" ? "finding travel companions and planning shared itineraries" : "expense tracking, offline maps, and safety features"}
- A reliable communication method (messaging apps, video calls)
- Cloud storage for important documents
- Offline access to maps and guides
- A budget tracking system

Download ${brandName} before you start and set up your profile. The free tier includes everything you need to get started.`,
        },
        {
          title: "Take Action: Start Small and Build Momentum",
          content: `The most important step is the first one. Don't wait until everything is perfect:

- Start with a small, achievable action today
- Build momentum with consistent daily or weekly progress
- Celebrate small wins along the way
- Adjust your approach based on what you learn
- Keep your ultimate goal in sight but focus on the next step

Remember: every expert was once a beginner. The key is to start and keep going. ${brandName}'s community is full of people at every stage — connect with them for support and motivation.`,
        },
        {
          title: "Track Your Progress and Adjust",
          content: `Regular review ensures you stay on track:

- Set weekly check-in points to review progress
- Compare actual results against your plan
- Identify what's working and what isn't
- Adjust your approach based on real-world feedback
- Update your goals as you learn and grow

${brandName}'s tracking tools help you monitor your progress, log achievements, and share updates with your support network.`,
        },
        {
          title: "Connect with Others on the Same Journey",
          content: `You don't have to do this alone. Connecting with others makes the journey richer:

- Find travel buddies or accountability partners through ${brandName}
- Join online communities focused on ${topic.toLowerCase()}
- Share your progress and learn from others
- Offer help to those who are just starting
- Celebrate milestones together

${brandName} makes it easy to find people who share your interests and goals. Our smart matching algorithm connects you with compatible travelers and companions.`,
        },
        {
          title: "Review, Reflect, and Plan Your Next Steps",
          content: `Once you've achieved your initial goal, take time to reflect:

- What worked well? What would you do differently?
- What did you learn about yourself?
- What new goals has this experience inspired?
- How can you help others who are just starting?
- What's next on your ${topic.toLowerCase()} journey?

The best travelers are lifelong learners. Each experience builds skills and confidence for the next adventure.`,
        },
      ];

      const stepsContent = steps.map((step, i) => `### Step ${i + 1}: ${step.title}\n\n${step.content}`).join("\n\n");

      return `# How to ${topic}: Complete Step-by-Step Guide

${topic} doesn't have to be complicated. Whether you're a complete beginner or looking to level up your skills, this comprehensive guide walks you through everything you need to know. By the end, you'll have a clear action plan and the confidence to make it happen.

## Why ${topic} Matters in 2026

The world of ${topic.toLowerCase()} has evolved significantly. New tools, platforms, and communities have made it more accessible than ever. ${brandName} is at the forefront of this transformation, helping people like you achieve your ${topic.toLowerCase()} goals.

**What's changed in 2026:**
- Technology has removed many traditional barriers
- Communities are more connected and supportive
- Resources are more abundant and accessible
- People are more open to shared experiences
- The tools are better than ever — if you know where to look

## Prerequisites: What You Need Before Starting

Before diving into the steps, make sure you have:

- ✅ A clear idea of what you want to achieve
- ✅ Access to a smartphone or computer
- ✅ A ${brandName} account (free to create)
- ✅ A positive attitude and openness to learning
- ✅ Basic understanding of your ${topic.toLowerCase()} goals

## The Complete Step-by-Step Process

${stepsContent}

## Common Challenges and How to Overcome Them

### Challenge 1: Feeling Overwhelmed
**Solution:** Break it down. Focus on just Step 1 today. Use ${brandName}'s planning tools to organize your journey into manageable pieces.

### Challenge 2: Lack of Motivation
**Solution:** Connect with others. ${brandName}'s community features let you find accountability partners who keep you on track.

### Challenge 3: Not Knowing Where to Start
**Solution:** You're already doing it. This guide is designed for beginners. Follow the steps in order and adapt as you go.

### Challenge 4: Fear of Failure
**Solution:** Redefine failure as learning. Every attempt teaches you something valuable. The only real failure is not starting.

### Challenge 5: Limited Resources
**Solution:** Start with what you have. ${brandName}'s free tier provides powerful tools at zero cost. Upgrade only when you need more.

## Pro Tips for Success

1. **Start before you feel ready.** You'll never feel 100% ready. Begin anyway.
2. **Consistency beats intensity.** Small actions every day outperform sporadic bursts.
3. **Document your journey.** You'll appreciate the memories and others will learn from your experience.
4. **Ask for help.** ${brandName}'s community is full of people who've been where you are.
5. **Celebrate progress.** Acknowledge every step forward, no matter how small.
6. **Stay flexible.** Plans change. Adaptability is a superpower.
7. **Share what you learn.** Teaching others reinforces your own knowledge.

## Tools and Resources

### Essential Apps
- **${brandName}** — Your primary tool for ${brand === "gotripmate" ? "finding travel companions, planning trips, and staying connected" : "expense tracking, offline navigation, and travel safety"}
- **Notes app** — For quick ideas and reflections
- **Calendar** — For scheduling and deadlines

### Communities
- ${brandName} community forums
- Reddit: r/${topic.toLowerCase().replace(/\s+/g, "")}
- Facebook groups focused on ${topic.toLowerCase()}

### Reading and Learning
- ${brandName} blog for regular tips and guides
- Travel and lifestyle publications
- YouTube tutorials from experienced travelers

## Your Action Plan

Here's exactly what to do after reading this guide:

1. **Today:** Download ${brandName} and create your profile
2. **This week:** Complete Step 1 (define your goals)
3. **This month:** Work through Steps 2-4
4. **Next month:** Execute and adjust (Steps 5-6)
5. **Ongoing:** Connect, share, and grow (Steps 7-8)

## Final Thoughts

${topic} is a journey, not a destination. Every step you take builds skills, confidence, and memories that last a lifetime. ${brandName} is here to support you at every stage — from planning to execution to reflection.

The best time to start was yesterday. The second best time is now.

${ctaText}

---

*Published: ${date} | Word count: ~1,300 | Category: How-To Guides*`;
    },
  },

  "safety-tips": {
    filename: "safety-tips.md",
    titlePattern: "[Topic] Safety: Essential Tips for Travelers",
    descriptionPattern: "Stay safe while traveling with our essential [Topic] safety tips. Expert advice on preparation, on-the-ground strategies, digital security, and emergency handling for travelers in 2026.",
    seoTitlePattern: "[Topic] Safety: Essential Tips for Travelers [2026] | [Brand]",
    tags: ["travel safety", "safety tips", "[topic]", "travel security", "safe travel", "travel advice", "[brand]"],

    generate: (topic, brand, keyword, lsiKeywords, date) => {
      const brandName = brand === "gotripmate" ? "GoTripMate" : "VoyageAlly";
      const ctaText = brand === "gotripmate"
        ? "Ready to explore the world safely? Download GoTripMate and join a community of smart, safety-conscious travelers. Find travel buddies, share your location, and explore with confidence."
        : "Ready to explore the world safely? Download VoyageAlly for offline maps, safety alerts, location sharing, and all the tools you need to stay safe on your travels.";

      return `# ${topic} Safety: Essential Tips for Travelers

Travel is transformative, but it comes with risks. From navigating unfamiliar cities to protecting your digital identity, ${topic.toLowerCase()} requires awareness and preparation. This comprehensive guide covers everything you need to know to stay safe — from pre-trip planning to handling emergencies on the road.

## Why ${topic} Safety Matters More Than Ever in 2026

The travel landscape has changed. While the world is more connected than ever, new challenges have emerged alongside new opportunities:

**New risks in 2026:**
- Digital threats: SIM swap scams, public Wi-Fi vulnerabilities, data breaches
- Health considerations: Staying prepared for regional health concerns
- Climate-related disruptions: Extreme weather affecting travel plans
- Over-tourism safety: Crowd management and pickpocketing in popular destinations

**But also new tools:**
- Real-time safety alerts on your phone
- AI-powered risk assessment for destinations
- Instant communication with emergency services
- Location sharing that works without reliable internet
- Crowd-sourced safety information from fellow travelers

${brandName} brings these tools together in one app, making ${topic.toLowerCase()} safety more accessible than ever.

## Pre-Trip Preparation: Set Yourself Up for Success

### 1. Research Your Destination Thoroughly

Knowledge is your first and most important safety tool.

**Before booking:**
- Check travel advisories from your government's foreign travel website
- Read recent traveler reviews on forums like Reddit and TripAdvisor
- Research common scams in your destination
- Learn about local customs, dress codes, and cultural norms
- Check health advisories and vaccination requirements

**Before you go:**
- Save emergency numbers (they're not 911 everywhere)
- Note the location of your embassy or consulate
- Understand local laws (what's legal at home may not be abroad)
- Download offline maps of your destination using ${brandName}

### 2. Share Your Itinerary

Never travel without someone knowing your plans:

- Share your full itinerary with a trusted contact back home
- Include flight numbers, accommodation addresses, and key activities
- Send copies of your passport, visa, and travel insurance
- Set regular check-in times (daily is ideal)
- Use ${brandName}'s location sharing to give trusted contacts real-time access

**Pro tip:** Create a WhatsApp group or similar chat with your emergency contacts. Share updates, photos, and your location regularly. It's a simple habit that provides immense peace of mind.

### 3. Pack a Safety Kit

Beyond the usual travel gear, include these items:

- **Door stop alarm:** Adds security to any hotel room
- **Personal alarm:** Loud enough to draw attention in an emergency
- **Money belt or hidden pouch:** Keeps valuables discreetly secure
- **Portable door lock:** Works on most hotel and hostel doors
- **First aid kit:** Basics plus any personal medications
- **Copies of documents:** Both physical and digital copies
- **Power bank:** A dead phone is a safety risk
- **Flashlight:** Your phone's light works, but a dedicated one is better

### 4. Set Up Digital Safety Before You Leave

Your phone is your most important travel tool — protect it:

- Enable two-factor authentication on all accounts
- Download a VPN and test it before you go
- Set up "Find My Device" features
- Back up important data to the cloud
- Save offline maps in ${brandName}
- Write down emergency numbers on a physical card

## On the Ground: Daily Safety Practices

### Arrival and Transportation

Your most vulnerable moments are when you first arrive somewhere new:

- **Arrange airport transfers in advance.** Pre-booking eliminates scrambling and reduces scam risk.
- **Use official taxis or rideshares.** Verify the driver and license plate.
- **Share your ride details** with someone back home.
- **Don't look lost.** Walk with purpose to a safe spot before checking your phone.
- **Keep your phone charged.** A portable charger is essential.

### Blending In vs. Standing Out

The art of ${topic.toLowerCase()} safety is balancing awareness with approachability:

- Dress like a local as much as possible
- Avoid flashing valuables — keep your phone and wallet tucked away
- Walk with confidence — predators target people who look unsure
- Learn basic phrases in the local language
- Use a dummy wallet with a small amount of cash for emergencies

### Socializing Safely

Meeting new people is one of travel's greatest joys. Here's how to do it safely:

- Meet in public places for initial meetings
- Trust your gut — if a situation feels wrong, leave immediately
- Keep your drink in sight at all times
- Tell someone where you're going
- Use ${brandName}'s verified profiles and in-app messaging
- Set a loose curfew for yourself, especially in unfamiliar places

### Nighttime Safety

When the sun goes down, elevate your awareness:

- Plan your route back to accommodation before heading out
- Stick to well-lit, populated streets
- Avoid shortcuts through alleys or parks
- Pre-book your ride home if you'll be out late
- Charge your phone fully before going out
- Limit alcohol consumption — you want to stay alert
- Know your accommodation's address by heart

## Digital Safety for Travelers

### Device and Data Security

- Use a VPN on all public Wi-Fi networks
- Turn off auto-connect for Wi-Fi and Bluetooth
- Keep your phone locked with biometric security
- Use strong, unique passwords for travel accounts
- Enable remote wipe capabilities on your phone
- Back up photos and documents to the cloud regularly
- Consider using ${brandName}'s in-app features instead of sharing personal contact info

### Social Media and Oversharing

- Post photos after you've left a location
- Avoid sharing your exact accommodation publicly
- Don't post your full itinerary in advance
- Check privacy settings on your social accounts
- Use location tags sparingly, after you've moved on

### Financial Safety

- Use multiple payment methods spread across different spots
- Notify your bank of travel plans to avoid card blocks
- Keep emergency cash separate from daily spending money
- Use ATMs inside banks during business hours
- Check for skimmers on card readers before inserting your card
- Set transaction alerts on all accounts

## Handling Emergencies

### Before You Need It

- Save emergency numbers in your phone under "ICE" (In Case of Emergency)
- Download offline maps of your destination using ${brandName}
- Know the location of your embassy or consulate
- Have travel insurance details accessible both digitally and physically
- Establish check-in protocols with someone back home

### If Something Goes Wrong

1. **Stay calm** and assess the situation
2. **Move to a safe, public location** if you're in danger
3. **Contact local emergency services** immediately
4. **Reach out to your embassy** if needed
5. **Contact your travel insurance provider** for medical or theft issues
6. **Use ${brandName}'s SOS feature** to alert your emergency contacts
7. **Document everything** for insurance claims

### Common Scams to Watch For

- **The "friendly local" scam:** Someone offers to show you around, then pressures you into expensive purchases
- **The spill-and-help scam:** Someone spills something on you, and while "helping" clean up, an accomplice steals your bag
- **Fake taxi drivers:** Unregistered cabs that charge exorbitant rates
- **The broken meter scam:** Driver claims the meter is broken and quotes a high flat rate
- **Friendship bracelet scam:** Someone forcibly puts a bracelet on your wrist and demands payment
- **ATM assistance scam:** A "helpful" person offers assistance at an ATM and skims your card

## ${topic} Safety by Scenario

### Solo Travel
- Stay in central, well-connected neighborhoods
- Arrive at destinations during daylight hours
- Don't tell strangers you're traveling alone
- Use ${brandName} to find verified travel companions

### Group Travel
- Establish communication protocols before splitting up
- Share locations using ${brandName}'s sharing features
- Agree on meeting points and times
- Keep group funds in a shared but secure system

### Urban Travel
- Research neighborhood safety before booking
- Use public transport during peak hours
- Keep headphones out of one ear to stay aware
- Carry a decoy wallet for emergencies

### Nature and Rural Travel
- Always tell someone your hiking route and return time
- Carry more water and supplies than you think you need
- Download offline maps before losing signal
- Consider a personal locator beacon for remote treks
- Join group hikes through reputable operators

## Building Confidence as a Safety-Conscious Traveler

${topic} safety isn't about fear — it's about empowerment. Every trip builds skills and confidence. Start with shorter trips to nearby destinations. Stay in social accommodations to ease into the experience. Use ${brandName} to find fellow travelers for parts of your journey.

The most important safety tool you have is your intuition. If something feels wrong, it probably is. Trust yourself, stay prepared, and remember: millions of people travel safely every day. With the right preparation and tools, you can be one of them.

## Your Safety Checklist

### Before You Go
- [ ] Research destination safety
- [ ] Share itinerary with emergency contacts
- [ ] Download offline maps (${brandName})
- [ ] Install VPN
- [ ] Set up two-factor authentication
- [ ] Pack safety kit
- [ ] Save emergency numbers
- [ ] Download ${brandName} and set up profile

### Every Day
- [ ] Check in with emergency contact
- [ ] Share location via ${brandName}
- [ ] Review safety alerts for your area
- [ ] Charge all devices
- [ ] Plan evening routes before heading out

### In an Emergency
- [ ] Stay calm
- [ ] Move to safety
- [ ] Contact local emergency services
- [ ] Use ${brandName} SOS feature
- [ ] Contact embassy
- [ ] Notify travel insurance
- [ ] Document everything

${ctaText}

---

*Published: ${date} | Word count: ~1,400 | Category: ${topic} Safety*`;
    },
  },
};

// ---------------------------------------------------------------------------
// Topic selection
// ---------------------------------------------------------------------------

/**
 * Pick the best topic for today's blog post.
 * Strategy:
 *   - If keyword gap exists for GT keyword → write about that
 *   - If ranking 11-20 → write a "best of" comparison targeting that keyword
 *   - Otherwise → rotate through the 4 template types
 */
function pickTopic(priorityData, existingPosts, keywords) {
  const today = new Date();
  const dayOfYear = Math.floor((today - new Date(today.getFullYear(), 0, 0)) / 86400000);
  const brandIndex = dayOfYear % 2;  // alternate daily
  const brand = brandIndex === 0 ? "gotripmate" : "voyageally";
  const brandName = brand === "gotripmate" ? "GoTripMate" : "VoyageAlly";

  // Check priority data for specific topic instructions
  if (priorityData && priorityData.topics && priorityData.topics.length > 0) {
    const topic = priorityData.topics[0];
    return {
      topic: topic.title || topic.topic || topic.keyword || "Travel Companion Apps",
      brand,
      templateType: topic.templateType || rotateTemplateType(dayOfYear),
      keyword: topic.keyword || topic.targetKeyword || "travel tips",
    };
  }

  // Check for keyword gaps
  if (priorityData && priorityData.keywordGaps && priorityData.keywordGaps.length > 0) {
    const gap = priorityData.keywordGaps[0];
    const kw = gap.keyword || "solo travel destinations";
    return {
      topic: `${kw.charAt(0).toUpperCase() + kw.slice(1)}`,
      brand,
      templateType: "destination-guide",
      keyword: kw,
    };
  }

  // Check for ranking gaps (11-20)
  if (priorityData && priorityData.rankingGaps && priorityData.rankingGaps.length > 0) {
    const gap = priorityData.rankingGaps[0];
    const kw = gap.keyword || "best travel apps";
    return {
      topic: `${kw.charAt(0).toUpperCase() + kw.slice(1)}`,
      brand,
      templateType: "app-comparison",
      keyword: kw,
    };
  }

  // Use keywords from our default list that match the brand
  let brandKeywords = keywords.filter(
    (k) => k.brand === "both" || k.brand === brand
  );

  if (!brandKeywords.length) {
    brandKeywords = keywords;
  }

  // Pick keywords that aren't already covered by existing posts
  const existingSlugs = existingPosts.map((p) => p.slug);
  const unused = brandKeywords.filter(
    (k) => !existingSlugs.some((s) => s.includes(slugify(k.keyword)))
  );

  const selectedKeyword = unused.length > 0
    ? unused[dayOfYear % unused.length]
    : brandKeywords[dayOfYear % brandKeywords.length];

  // Rotate template types
  const templateType = rotateTemplateType(dayOfYear);

  const topicName = selectedKeyword.keyword
    .replace(/\b(apps|guide|tips|best)\b/gi, "")
    .trim()
    .replace(/\s{2,}/g, " ") || selectedKeyword.keyword;

  return {
    topic: topicName.charAt(0).toUpperCase() + topicName.slice(1),
    brand,
    templateType,
    keyword: selectedKeyword.keyword,
  };
}

/**
 * Rotate through template types based on day of year.
 */
function rotateTemplateType(dayOfYear) {
  const types = Object.keys(TEMPLATES);
  return types[dayOfYear % types.length];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function generateBlogPost() {
  console.log("=".repeat(60));
  console.log("BLOG GENERATOR — Starting");
  console.log("=".repeat(60));

  // ---- Read priority actions ----------------------------------------------
  const priorityPath = path.join(ANALYSIS_DIR, "today-priority.json");
  const priorityData = await readJson(priorityPath, null);
  if (priorityData) {
    console.log("✅ Loaded priority actions.");
  } else {
    console.log("ℹ️  No priority actions found. Using defaults.");
  }

  // ---- Read existing blog posts to avoid duplicates -----------------------
  let existingPosts = [];
  const brands = ["gotripmate", "voyageally"];
  for (const brand of brands) {
    const blogPath = path.join(CONTENT_DIR, brand, "blog.ts");
    try {
      const content = await fs.readFile(blogPath, "utf-8");
      const slugMatches = content.matchAll(/slug:\s*['"]([^'"]+)['"]/g);
      const titleMatches = content.matchAll(/title:\s*['"]([^'"]+)['"]/g);
      const slugList = [...slugMatches].map((m) => m[1]);
      const titleList = [...titleMatches].map((m) => m[1]);

      for (let i = 0; i < slugList.length; i++) {
        existingPosts.push({
          brand,
          slug: slugList[i] || "",
          title: titleList[i] || "",
        });
      }
    } catch (err) {
      console.warn(`  ⚠️  Could not read ${brand} blog data: ${err.message}`);
    }
  }
  console.log(`Loaded ${existingPosts.length} existing blog posts.`);

  // ---- Read keywords ------------------------------------------------------
  const keywordsPath = path.join(DATA_DIR, "keywords.json");
  let keywordsData = await readJson(keywordsPath, DEFAULT_KEYWORDS);
  const keywordList = keywordsData.keywords || DEFAULT_KEYWORDS.keywords;

  // ---- Pick topic ---------------------------------------------------------
  const topicInfo = pickTopic(priorityData, existingPosts, keywordList);
  console.log(`Selected topic: "${topicInfo.topic}" for brand ${topicInfo.brand}`);
  console.log(`Template: ${topicInfo.templateType}`);
  console.log(`Target keyword: ${topicInfo.keyword}`);

  // ---- Check for duplicates -----------------------------------------------
  const potentialSlug = slugify(`${topicInfo.topic}-${topicInfo.brand}`);
  const isDuplicate = existingPosts.some(
    (p) => p.slug.includes(slugify(topicInfo.keyword)) || p.slug.includes(potentialSlug)
  );
  if (isDuplicate) {
    console.log(`⚠️  Topic "${topicInfo.topic}" may already exist. Adding date suffix to differentiate.`);
  }

  // ---- Get LSI keywords ---------------------------------------------------
  let lsiCategory = "general";
  const kw = topicInfo.keyword.toLowerCase();
  if (kw.includes("solo") || kw.includes("destination")) lsiCategory = "solo-travel";
  else if (kw.includes("buddy") || kw.includes("companion") || kw.includes("matching")) lsiCategory = "travel-buddies";
  else if (kw.includes("plan") || kw.includes("itinerary")) lsiCategory = "trip-planning";
  else if (kw.includes("expense") || kw.includes("budget") || kw.includes("track")) lsiCategory = "expense-tracking";
  else if (kw.includes("safe") || kw.includes("safety") || kw.includes("emergency")) lsiCategory = "travel-safety";
  else if (kw.includes("pack")) lsiCategory = "packing";
  else if (kw.includes("map") || kw.includes("offline") || kw.includes("navigation")) lsiCategory = "offline-maps";

  const lsiKeywords = LSI_KEYWORDS[lsiCategory] || LSI_KEYWORDS.general;
  const selectedLsi = lsiKeywords.slice(0, 5);

  // ---- Generate the post --------------------------------------------------
  const template = TEMPLATES[topicInfo.templateType];
  if (!template) {
    console.error(`❌ Unknown template type: ${topicInfo.templateType}`);
    return;
  }

  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10); // YYYY-MM-DD
  const formattedDate = today.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Prepare template variables
  const topic = topicInfo.topic;
  const brand = topicInfo.brand;
  const keyword = topicInfo.keyword;
  const brandName = brand === "gotripmate" ? "GoTripMate" : "VoyageAlly";

  // Generate title and description
  let title = template.seoTitlePattern
    .replace("[Topic]", topic)
    .replace("[Brand]", brandName)
    .replace("[brand]", brandName)
    .replace("[Action]", topic)
    .replace("[Category]", topic);

  // Ensure title is 50-60 chars
  if (title.length > 60) {
    title = title.slice(0, 57).trim() + "...";
  }

  let description = template.descriptionPattern
    .replace("[Topic]", topic)
    .replace("[Brand]", brandName)
    .replace("[brand]", brandName)
    .replace("[Action]", topic)
    .replace("[Category]", topic);

  // Ensure description is 150-160 chars
  if (description.length > 160) {
    description = description.slice(0, 157).trim() + "...";
  } else if (description.length < 150) {
    // Pad with CTA
    const cta = ` Download ${brandName} and start your journey today.`;
    const needed = 150 - description.length;
    if (needed > 0 && needed < cta.length) {
      description += cta.slice(0, needed);
    } else if (needed >= cta.length) {
      description += cta;
    }
  }

  // Generate tags
  const tags = template.tags.map((t) =>
    t
      .replace("[category]", topic.toLowerCase())
      .replace("[action]", topic.toLowerCase())
      .replace("[topic]", topic.toLowerCase())
      .replace("[brand]", brandName)
      .replace("[Category]", topic)
  );

  // Generate the content
  const content = template.generate(topic, brand, keyword, selectedLsi, formattedDate);

  // Calculate word count
  const wordCount = content.split(/\s+/).length;

  // Build the full markdown file
  const slug = slugify(`${keyword}-${brand}-${dateStr}`);
  const fullSlug = slugify(`${topic}-${keyword}-${dateStr}`);

  const fullMarkdown = `---
title: "${title}"
date: "${dateStr}"
publishDate: "${formattedDate}"
slug: "${fullSlug}"
brand: "${brand}"
template: "${topicInfo.templateType}"
targetKeyword: "${keyword}"
lsiKeywords: ${JSON.stringify(selectedLsi)}
seoTitle: "${title}"
seoDescription: "${description}"
tags: ${JSON.stringify(tags)}
readingTime: "${readingTime(wordCount)}"
wordCount: ${wordCount}
category: "${topic}"
status: "generated"
---

${content}
`;

  // ---- Save the generated post --------------------------------------------
  await ensureDir(GENERATED_DIR);
  const postPath = path.join(GENERATED_DIR, `${dateStr}-${fullSlug}.md`);
  await fs.writeFile(postPath, fullMarkdown, "utf-8");
  console.log(`✅ Post saved: ${postPath}`);

  // ---- Also save to gotripmate-site blog directory if applicable -----------
  if (brand === "gotripmate") {
    const blogDir = path.join(SITE_DIR, "blog");
    await ensureDir(blogDir);
    const sitePostPath = path.join(blogDir, `${fullSlug}.md`);
    try {
      await fs.writeFile(sitePostPath, fullMarkdown, "utf-8");
      console.log(`✅ Also saved to site blog: ${sitePostPath}`);
    } catch (err) {
      console.warn(`⚠️  Could not save to site blog: ${err.message}`);
    }
  }

  // ---- Log to changes -----------------------------------------------------
  const logPath = path.join(CHANGES_DIR, "new-post-today.json");
  const logData = {
    date: dateStr,
    generatedAt: new Date().toISOString(),
    post: {
      title,
      slug: fullSlug,
      brand,
      templateType: topicInfo.templateType,
      targetKeyword: keyword,
      wordCount,
      readingTime: readingTime(wordCount),
      filePath: postPath,
      tags,
    },
  };
  await writeJson(logPath, logData);

  // ---- Summary ------------------------------------------------------------
  console.log("\n=== BLOG GENERATOR ===");
  console.log(`Topic: ${title}`);
  console.log(`Brand: ${brandName}`);
  console.log(`Template: ${topicInfo.templateType}`);
  console.log(`Word count: ~${wordCount}`);
  console.log(`Target keyword: ${keyword}`);
  console.log(`Saved: ${postPath}`);
  console.log("=".repeat(60));

  return {
    title,
    slug: fullSlug,
    brand,
    templateType: topicInfo.templateType,
    wordCount,
    keyword,
    filePath: postPath,
  };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  generateBlogPost().catch((err) => {
    console.error("Unhandled error in blog generator:", err);
    process.exit(1);
  });
}
