// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Google Careers provider - parses the public server-rendered search results.
//
// Paginates via `page=N` (1-indexed) and stops using the exact total from the
// page's own "Showing X to Y of Z rows" indicator — mirrors the total-based
// approach in providers/workday.mjs, just read from HTML instead of a JSON
// `total` field. Falls back to a short-page/zero-page heuristic (same one
// providers/workday.mjs:267 uses) if that indicator is ever missing.
//
// Also supports server-side location filtering via repeated `location=`
// params, which Google combines as a union (verified). Batched in groups of
// at most 4 per request — the cap observed in Google's own location picker
// UI — with additional locations run as separate paginated batches, merged
// and deduped by url.
//
// Always sorts newest-first (`sort_by=date`) — no downside for a scanner.

import { decodeEntities } from './_html-entities.mjs';
import { sleep } from './_http.mjs';

const BASE_URL =
	"https://www.google.com/about/careers/applications/jobs/results/";
const APP_BASE_URL = "https://www.google.com/about/careers/applications/";

// Pagination safety net, mirrors providers/workday.mjs: a positive
// `max_pages` on the entry overrides DEFAULT_MAX_PAGES, capped at
// MAX_PAGES_CAP even then.
const DEFAULT_MAX_PAGES = 10;
const MAX_PAGES_CAP = 50;

// Google's own location picker stops accepting more than 4 selections.
const MAX_LOCATIONS_PER_REQUEST = 4;

const INTER_PAGE_DELAY_MS = 250;

const TOTAL_RE = /Showing\s+(\d+)\s+to\s+(\d+)\s+of\s+(\d+)\s+rows/i;

function cleanText(value = "") {
	return decodeEntities(String(value).replace(/<[^>]+>/g, " "))
		.replace(/\s+/g, " ")
		.trim();
}

function firstMatch(source, re) {
	const m = re.exec(source);
	return m ? m[1] : "";
}

function resolveJobUrl(rawHref) {
	if (!rawHref) return "";
	try {
		// Google's job cards echo the current search context (q, location,
		// sort_by, page) back onto every job link. Strip it: the same posting
		// must resolve to the same URL regardless of which query/location/page
		// found it, or scan.mjs's URL-based dedup (data/scan-history.tsv) would
		// re-add it as "new" every time the search context differs.
		const parsed = new URL(decodeEntities(rawHref), APP_BASE_URL);
		return parsed.origin + parsed.pathname;
	} catch {
		return "";
	}
}

/**
 * @param {import('./_types.js').PortalEntry & {google?: Record<string, unknown>}} entry
 * @param {number} [page] 1-indexed
 * @param {string[]} [locations] up to MAX_LOCATIONS_PER_REQUEST values, sent as repeated `location=` params
 */
export function buildGoogleCareersUrl(entry = {}, page = 1, locations = []) {
	const cfg =
		entry.google && typeof entry.google === "object" ? entry.google : {};
	const query = cfg.query ?? entry.query ?? entry.search ?? "";
	const url = new URL(BASE_URL);
	if (query) url.searchParams.set("q", String(query));
	for (const location of locations.slice(0, MAX_LOCATIONS_PER_REQUEST)) {
		if (location) url.searchParams.append("location", String(location));
	}
	if (page > 1) url.searchParams.set("page", String(page));
	url.searchParams.set("sort_by", "date");
	return url.href;
}

/** Positive `max_pages` on the entry overrides the default, capped at MAX_PAGES_CAP. */
function resolveMaxPages(entry) {
	const v = entry?.max_pages;
	if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
	return DEFAULT_MAX_PAGES;
}

/** Reads entry.google.location (string or array) into batches of at most MAX_LOCATIONS_PER_REQUEST. */
function resolveLocationBatches(entry) {
	const cfg =
		entry.google && typeof entry.google === "object" ? entry.google : {};
	const raw = cfg.location;
	const locations = Array.isArray(raw)
		? raw.filter((v) => typeof v === "string" && v.trim())
		: typeof raw === "string" && raw.trim()
			? [raw]
			: [];
	if (locations.length === 0) return [[]];
	const batches = [];
	for (let i = 0; i < locations.length; i += MAX_LOCATIONS_PER_REQUEST) {
		batches.push(locations.slice(i, i + MAX_LOCATIONS_PER_REQUEST));
	}
	return batches;
}

/** Parses "Showing X to Y of Z rows" into { pageSize, total }, or null if absent (e.g. zero results). */
function parseTotalIndicator(html) {
	const m = TOTAL_RE.exec(html);
	if (!m) return null;
	const from = Number(m[1]);
	const to = Number(m[2]);
	const total = Number(m[3]);
	if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(total)) return null;
	const pageSize = to - from + 1;
	if (pageSize <= 0) return null;
	return { pageSize, total };
}

/** Fetches one location batch (or the unfiltered search when locations is []), paginating to its exact total. */
async function fetchLocationBatch(entry, ctx, locations, maxPages, ctxCap) {
	const pagesCap = Math.min(maxPages, ctxCap);
	const jobs = [];
	let pagesToFetch = pagesCap;
	let prevCount = null;

	for (let page = 1; page <= pagesToFetch; page++) {
		let html;
		try {
			html = await ctx.fetchText(buildGoogleCareersUrl(entry, page, locations), {
				redirect: "error",
			});
		} catch (err) {
			if (page === 1) throw err;
			console.error(
				`⚠️  google-careers: ${entry.name || "Google"}${locations.length ? ` (${locations.join(", ")})` : ""} truncated at page ${page}: ${err.message}`,
			);
			break;
		}

		const pageJobs = parseGoogleCareersHtml(html);
		if (pageJobs.length === 0) break;
		jobs.push(...pageJobs);

		if (page === 1) {
			const indicator = parseTotalIndicator(html);
			if (indicator) {
				pagesToFetch = Math.min(Math.ceil(indicator.total / indicator.pageSize), pagesCap);
			}
		} else if (prevCount !== null && pageJobs.length < prevCount) {
			break; // fallback heuristic: short page after a full one → last page
		}
		prevCount = pageJobs.length;

		if (page < pagesToFetch) await sleep(INTER_PAGE_DELAY_MS, ctx);
	}

	return jobs;
}

/** @param {string} html */
export function parseGoogleCareersHtml(html) {
	if (typeof html !== "string" || !html.trim()) return [];
	const jobs = [];
	const seen = new Set();
	const cardRe =
		/<li\b[^>]*class=["'][^"']*\blLd3Je\b[^"']*["'][^>]*>[\s\S]*?(?=<li\b[^>]*class=["'][^"']*\blLd3Je\b|<\/main>|$)/gi;

	for (const m of html.matchAll(cardRe)) {
		const card = m[0];
		const title = cleanText(
			firstMatch(
				card,
				/<h3\b[^>]*class=["'][^"']*\bQJPWVe\b[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i,
			),
		);
		const href = firstMatch(
			card,
			/<a\b[^>]+href=["']([^"']*jobs\/results\/[^"']+)["']/i,
		);
		const url = resolveJobUrl(href);
		if (!title || !url || seen.has(url)) continue;
		seen.add(url);

		const location = cleanText(
			firstMatch(
				card,
				/<span\b[^>]*class=["'][^"']*\br0wTof\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
			) ||
				firstMatch(
					card,
					/<span\b[^>]*class=["'][^"']*\bpwO9Dc\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
				),
		);

		jobs.push({
			title,
			url,
			company: "Google",
			location,
		});
	}

	return jobs;
}

/** @type {Provider} */
export default {
	id: "google-careers",

	detect(entry) {
		const url = entry.api || entry.careers_url || "";
		if (typeof url !== "string") return null;
		try {
			const parsed = new URL(url);
			const host = parsed.host.toLowerCase();
			if (
				(host === "www.google.com" || host === "careers.google.com") &&
				parsed.pathname.includes("/careers/applications/jobs")
			) {
				return { url };
			}
		} catch {
			/* not an absolute URL */
		}
		return null;
	},

	async fetch(entry, ctx) {
		const maxPages = resolveMaxPages(entry);
		const ctxCap =
			Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0 ? ctx.maxPages : Infinity;
		const batches = resolveLocationBatches(entry);

		const seen = new Set();
		const allJobs = [];
		for (const locations of batches) {
			const jobs = await fetchLocationBatch(entry, ctx, locations, maxPages, ctxCap);
			for (const job of jobs) {
				if (seen.has(job.url)) continue;
				seen.add(job.url);
				allJobs.push(job);
			}
		}

		return allJobs.map((job) => ({
			...job,
			company: entry.name || job.company,
		}));
	},
};
