// tests/providers/google-careers.test.mjs — local fork provider (google.com/about/careers).
//
// Offline: fetch() runs against a mock ctx serving canned result pages, so a
// change to the shared provider contract or HTML helpers shows up here rather
// than as a silently empty scan.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — google-careers (google.com/about/careers HTML)');

function card(id, title, location) {
  return `<li class="lLd3Je"><div><h3 class="QJPWVe">${title}</h3>`
    + `<span class="r0wTof">${location}</span>`
    + `<a href="jobs/results/${id}-slug?q=x&amp;page=2">Learn more</a></div></li>`;
}

function page(cards, from, to, total) {
  return `<main><div>Showing ${from} to ${to} of ${total} rows</div><ul>${cards.join('')}</ul></main>`;
}

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/google-careers.mjs')).href);
  const google = mod.default;
  const { parseGoogleCareersHtml, buildGoogleCareersUrl } = mod;

  if (google.id === 'google-careers') pass('google-careers.id');
  else fail(`google-careers.id is ${JSON.stringify(google.id)}`);

  // detect()
  if (google.detect({ careers_url: 'https://www.google.com/about/careers/applications/jobs/results/' })) pass('detect() claims the Google careers results URL');
  else fail('detect() should claim the Google careers results URL');
  if (google.detect({ careers_url: 'https://evil.example/about/careers/applications/jobs/' }) === null) pass('detect() rejects another host');
  else fail('detect() must reject other hosts');
  if (google.detect({ careers_url: 42 }) === null) pass('detect() returns null for a non-string URL');
  else fail('detect() should return null for a non-string URL');

  // parse
  const jobs = parseGoogleCareersHtml(page([
    card('111', 'Staff Software Engineer, AI &amp; ML', 'Zurich, Switzerland'),
    card('111', 'Duplicate card', 'Zurich, Switzerland'),
    card('222', 'Customer Engineer', 'Helsinki, Finland'),
  ], 1, 3, 3));
  if (jobs.length === 2) pass('parse drops duplicate job URLs');
  else fail(`parse returned ${jobs.length} jobs, expected 2`);
  if (jobs[0]?.title === 'Staff Software Engineer, AI & ML') pass('parse decodes entities in the title');
  else fail(`parse title: ${JSON.stringify(jobs[0]?.title)}`);
  if (jobs[0]?.url === 'https://www.google.com/about/careers/applications/jobs/results/111-slug') pass('parse resolves an absolute URL without the query string');
  else fail(`parse url: ${JSON.stringify(jobs[0]?.url)}`);
  if (jobs[1]?.location === 'Helsinki, Finland') pass('parse reads the location');
  else fail(`parse location: ${JSON.stringify(jobs[1]?.location)}`);
  if (parseGoogleCareersHtml('').length === 0 && parseGoogleCareersHtml(null).length === 0) pass('parse tolerates empty input');
  else fail('parse should return [] for empty input');

  // URL building
  const u = new URL(buildGoogleCareersUrl({ google: { query: 'AI Engineer' } }, 3, ['Helsinki, Finland', 'Zurich, Switzerland']));
  if (u.searchParams.get('q') === 'AI Engineer' && u.searchParams.get('page') === '3'
    && u.searchParams.getAll('location').length === 2 && u.searchParams.get('sort_by') === 'date') {
    pass('buildGoogleCareersUrl sets q, page, repeated location and sort_by');
  } else fail(`buildGoogleCareersUrl: ${u.href}`);

  // fetch(): paginates to the reported total, batches locations by 4, dedups
  // across batches, stamps the entry name.
  const requested = [];
  const pages = {
    1: page([card('1', 'A', 'X'), card('2', 'B', 'X')], 1, 2, 5),
    2: page([card('3', 'C', 'X'), card('4', 'D', 'X')], 3, 4, 5),
    3: page([card('5', 'E', 'X')], 5, 5, 5),
  };
  const ctx = {
    async fetchText(url) {
      requested.push(url);
      const p = Number(new URL(url).searchParams.get('page') || '1');
      return pages[p] ?? '';
    },
    sleep: async () => {},
  };
  const entry = {
    name: 'Google',
    google: { query: 'Engineer', location: ['L1', 'L2', 'L3', 'L4', 'L5'] },
  };
  const fetched = await google.fetch(entry, ctx);
  // Two location batches (4 + 1), each paginating 3 pages; the second batch
  // returns the same URLs, so dedup keeps 5.
  if (requested.length === 6) pass('fetch paginates each location batch to the reported total');
  else fail(`fetch made ${requested.length} requests, expected 6`);
  if (fetched.length === 5) pass('fetch dedups jobs across location batches');
  else fail(`fetch returned ${fetched.length} jobs, expected 5`);
  if (fetched.every((j) => j.company === 'Google')) pass('fetch stamps the entry name as company');
  else fail('fetch should stamp entry.name as company');
  if (new URL(requested[0]).searchParams.getAll('location').length === 4) pass('fetch sends at most 4 locations per request');
  else fail(`first request locations: ${requested[0]}`);

  // ctx.maxPages caps pagination.
  requested.length = 0;
  await google.fetch({ name: 'Google', google: { query: 'Engineer' } }, { ...ctx, maxPages: 1 });
  if (requested.length === 1) pass('fetch honours ctx.maxPages');
  else fail(`fetch with maxPages=1 made ${requested.length} requests`);
} catch (err) {
  fail(`google-careers provider tests crashed: ${err.stack || err.message}`);
}
