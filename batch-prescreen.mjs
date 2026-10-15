#!/usr/bin/env node
// career-ops batch pre-check gate (deterministic, zero tokens).
//
// Quick scope check over a prefetched JD text: does the posting's LOCATION and
// TECH STACK fall inside the candidate's declared search scope? Out-of-scope
// postings are skipped before an LLM worker ever runs.
//
// Protocol: prints one line to stdout —
//   PASS            → in scope (or inconclusive; fail-open by design)
//   SKIP: {reason}  → out of scope
//
// Usage: node batch-prescreen.mjs <jd-text-file> [config/profile.yml]
//
// Fail-open policy: ambiguous evidence (remote/EMEA/Europe qualifiers, thin or
// unreadable JD text) passes through. Only POSITIVE evidence of mismatch skips.
// The JD is untrusted external content — this script only pattern-matches it,
// never follows anything written in it.

import { readFileSync } from 'node:fs';

function main() {
  const [jdFile, profileFile] = process.argv.slice(2);
  if (!jdFile) return printPass();

  let text;
  try {
    text = readFileSync(jdFile, 'utf8');
  } catch {
    return printPass();
  }
  if (!text || text.trim().split(/\s+/).length < 40) return printPass(); // too thin to judge

  const lower = text.toLowerCase();
  // Pseudo-title: first heading-ish line or the opening 200 chars.
  const title = extractTitle(text);

  // ---- Location gate -------------------------------------------------------
  const targets = loadTargets(profileFile);
  if (targets.length && !targets.some((t) => tokenRe(t).test(lower))) {
    // No target location anywhere in the JD. Decide per out-of-scope mention:
    // a LOCAL qualifier (±80 chars) like "Remote", "EMEA", "Europe" makes it
    // inconclusive (fail-open); a bare concrete office ("our London office")
    // with no qualifying context is positive evidence of being out of scope.
    // Qualifiers elsewhere in the document (benefits blurbs, team descriptions)
    // must not mask a concrete out-of-scope office listing.
    for (const loc of NON_TARGET_LOCATIONS) {
      const m = tokenRe(loc).exec(lower);
      if (!m) continue;
      const ctx = lower.slice(Math.max(0, m.index - 80), m.index + loc.length + 80);
      const qualified = AMBIGUOUS_LOCATION.some((q) => tokenRe(q).test(ctx));
      if (!qualified) {
        console.log('SKIP: location outside target countries/California (' + loc + ')');
        return;
      }
    }
    // All out-of-scope mentions were locally qualified (remote/EMEA/etc): pass.
  }

  // ---- Tech-stack / domain gate --------------------------------------------
  if (POSITIVE_TITLE.test(title)) return printPass();
  if (!POSITIVE_SIGNALS.test(lower)) {
    for (const { re, label } of NEGATIVE_DOMAINS) {
      if (re.test(title)) {
        console.log('SKIP: tech stack mismatch - ' + label + ' role, no AI-application signals');
        return;
      }
    }
    const bodyHits = [...new Set(NEGATIVE_DOMAINS.filter(({ re }) => re.test(lower)).map(({ label }) => label))];
    if (bodyHits.length >= 2) {
      console.log('SKIP: tech stack mismatch - multiple non-target domains (' + bodyHits.slice(0, 3).join(', ') + ')');
      return;
    }
    if (bodyHits.length === 1 && !POSITIVE_SIGNALS.test(lower)) {
      // Single weak negative in body without any AI signal: still skip only when
      // the title is also non-AI generic. Otherwise pass.
      if (!POSITIVE_SIGNALS.test(title.toLowerCase())) {
        console.log('SKIP: tech stack mismatch - ' + bodyHits[0] + ', no AI-application signals');
        return;
      }
    }
  }

  printPass();
}

function printPass() {
  console.log('PASS');
}

function extractTitle(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const l of lines.slice(0, 10)) {
    if (/^(job|position|role|title)[:\s]/i.test(l)) return l.slice(0, 200);
    if (l.length >= 8 && l.length <= 160 && !/^(about|we |our |at \w)/i.test(l)) return l;
  }
  return text.slice(0, 200);
}

function tokenRe(token) {
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(?<![a-z0-9])' + esc + '(?![a-z0-9])', 'i');
}

// Minimal YAML list reader for config/profile.yml (target_countries /
// us_target_locations). No YAML dependency needed for this narrow shape.
function loadTargets(profileFile) {
  const out = [];
  let cfg = '';
  try {
    cfg = readFileSync(profileFile || 'config/profile.yml', 'utf8').toLowerCase();
  } catch {
    return out;
  }
  for (const key of ['target_countries', 'us_target_locations']) {
    const m = cfg.match(new RegExp('^\\s*' + key + ':\\s*$', 'm'));
    if (!m) continue;
    const rest = cfg.slice(m.index + m[0].length);
    for (const line of rest.split('\n').slice(1)) {
      if (/^\s*[\w_-]+:\s*(\S|$)/.test(line)) break; // next YAML key
      const item = line.match(/^\s*-\s+"?([^"\n#]+)"?/);
      if (item) out.push(item[1].trim());
      else if (line.trim()) break;
    }
  }
  return expandAliases(out);
}

// Map country entries to their common city spellings so a posting that only
// names "Stockholm" or "Zürich" still matches its target country.
const CITY_ALIASES = {
  finland: ['finland', 'helsinki', 'espoo', 'vantaa'],
  sweden: ['sweden', 'stockholm', 'gothenburg', 'göteborg', 'malmo', 'malmö'],
  denmark: ['denmark', 'copenhagen', 'københavn', 'kobenhavn', 'aarhus'],
  netherlands: ['netherlands', 'amsterdam', 'rotterdam', 'eindhoven', 'utrecht'],
  switzerland: ['switzerland', 'zurich', 'zürich', 'geneva', 'genève', 'basel', 'bern', 'lausanne', 'zug'],
  germany: ['germany', 'berlin', 'munich', 'münchen', 'hamburg', 'frankfurt', 'stuttgart', 'cologne', 'köln', 'düsseldorf', 'dusseldorf', 'eschborn', 'walldorf'],
  france: ['france', 'paris', 'lyon', 'toulouse', 'bordeaux', 'nantes', 'grenoble'],
  spain: ['spain', 'madrid', 'barcelona', 'malaga', 'málaga', 'valencia', 'seville', 'sevilla', 'bilbao'],
};

function expandAliases(targets) {
  const set = new Set();
  for (const t of targets) {
    const k = t.toLowerCase();
    set.add(k);
    if (CITY_ALIASES[k]) CITY_ALIASES[k].forEach((a) => set.add(a));
  }
  // Common California cities beyond the explicit us_target_locations entries.
  ['san francisco', 'san jose', 'santa clara', 'redwood city', 'oakland', 'berkeley', 'menlo park', 'cupertino', 'fremont'].forEach((c) => set.add(c));
  return [...set];
}

// Locations that alone place a role OUTSIDE the candidate's scope.
const NON_TARGET_LOCATIONS = [
  'new york', 'nyc', 'boston', 'chicago', 'austin', 'texas', 'seattle', 'washington',
  'oregon', 'nevada', 'colorado', 'utah', 'phoenix', 'salt lake', 'atlanta', 'georgia',
  'miami', 'florida', 'denver',
  'london', 'united kingdom', 'england', 'scotland', 'edinburgh', 'ireland', 'dublin',
  'poland', 'warsaw', 'krakow', 'portugal', 'lisbon', 'porto', 'italy', 'milan', 'rome',
  'romania', 'bucharest', 'czech', 'prague', 'hungary', 'budapest', 'greece', 'athens',
  'austria', 'vienna', 'belgium', 'brussels', 'luxembourg', 'norway', 'oslo', 'estonia',
  'tallinn', 'latvia', 'riga', 'lithuania', 'vilnius', 'serbia', 'croatia', 'slovenia',
  'slovakia', 'ukraine', 'kyiv', 'turkey', 'istanbul',
  'canada', 'toronto', 'vancouver', 'montreal', 'quebec',
  'dubai', 'united arab emirates', 'saudi', 'riyadh', 'qatar', 'doha', 'israel',
  'tel aviv', 'india', 'bangalore', 'bengaluru', 'singapore', 'japan', 'tokyo',
  'australia', 'sydney', 'melbourne', 'brazil', 'sao paulo', 'mexico',
];

// Qualifiers that make a location listing inconclusive (never skip on them).
const AMBIGUOUS_LOCATION = [
  'remote', 'hybrid', 'emea', 'europe', 'european union', 'global', 'anywhere',
  'distributed', 'work from home', 'united states',
];

// AI-application signals that rescue a posting from the domain gate.
const POSITIVE_SIGNALS =
  /\b(agent(s)?\b|agentic|\bllms?\b|genai|gen[- ]ai|generative ai|applied ai|ai engineer|ai platform|ai infrastructure|forward[- ]deployed|solutions? (architect|engineer)|customer engineer|technical lead|engineering manager|\brag\b|retrieval[- ]augmented|prompt engineering|foundation model|fine[- ]?tuning|multimodal|conversational ai|chatbot|\bcopilot\b|openai|anthropic|vertex ai|bedrock|evals?)\b/i;

const POSITIVE_TITLE = new RegExp(POSITIVE_SIGNALS.source, 'i');

// Domains outside the candidate's target work. Checked against the title
// first (strong signal), then the body (weak, needs corroboration).
const NEGATIVE_DOMAINS = [
  { label: 'frontend-only engineering', re: /\b(front[- ]?end|frontend)\b/i },
  { label: 'ads/ranking ML', re: /search ads|youtube ads|ads marketplace|ad(vertising)? (ranking|auction|monetization)|adtech/i },
  { label: 'kernel/driver/firmware systems', re: /\b(kernel|firmware|silicon)\b|\bdevice drivers?\b|\bsoc\b/i },
  { label: 'network infrastructure', re: /network (infrastructure|engineer|protocol|stack)|netinfra|\bnetsoft\b|wan & edge/i },
  { label: 'site reliability engineering', re: /site reliability|\bsre\b/i },
  { label: 'QA/test automation', re: /\bqa\b|test automation|\bsdet\b|quality assurance/i },
  { label: 'data engineering/pipelines', re: /\bdata engineer|\bdata pipelines?\b|analytics engineer|business intelligence|\betl\b/i },
  { label: 'security engineering', re: /security engineer|red team|penetration test|application security|\bappsec\b|threat detection/i },
  { label: 'research science', re: /research scientist|research engineer|applied scientist/i },
  { label: 'sales/GTM', re: /account executive|sales development|business development|enterprise sales|talent acquisition|recruiter|marketing manager/i },
  { label: 'mobile client development', re: /\bios\b (engineer|developer)|android (engineer|developer)|mobile (engineer|developer)/i },
  { label: 'embedded/robotics', re: /\bembedded\b|robotics|autonomous vehicle/i },
  { label: 'ERP configuration', re: /\bnetsuite\b|\berp\b (consultant|configuration)|sap (consultant|configuration)/i },
];

main();
