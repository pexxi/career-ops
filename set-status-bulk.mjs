#!/usr/bin/env node

/**
 * set-status-bulk.mjs — set one status on many tracker rows in one atomic write.
 *
 * Local fork addition (not shipped upstream, so the auto-updater leaves it
 * alone). Single-row changes stay on upstream set-status.mjs; this is the bulk
 * path the web pipeline bar and the dashboard multi-select call.
 *
 * Usage:
 *   node set-status-bulk.mjs --rows N,N[,N...] <state> [--note "..."] [--on YYYY-MM-DD]
 *                            [--source set-status|web] [--dry-run] [--json]
 *
 * All-or-nothing: every requested tracker # must resolve to exactly one row,
 * otherwise nothing is written. One tracker lock, one atomic write, one
 * status-log line per row whose status changed. Rows that become Applied get
 * their first follow-up seeded after the lock is released (same policy as
 * set-status.mjs: a seeding failure never fails the status change).
 *
 * --json prints one document:
 *   { applied, target, source, outcomes: [{kind, n, ...}], trackerWritten,
 *     ledgerWritten, ledgerWarning?, followupsSeeded? }
 *   or { applied: false, reason: 'row-resolution-failed', target, source, outcomes }
 *
 * Exit codes: 0 applied (including no-op) · 1 usage / invalid state / write
 * failure · 2 single id not found · 3 single id ambiguous · 4 lock timeout ·
 * 5 batch rejected (some id not found or ambiguous; nothing written).
 */

import { readFileSync, existsSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { resolveColumns, parseTrackerRow, splitTrackerCells, trackerRowSeparator } from './tracker-parse.mjs';
import { localToday } from './lib/local-today.mjs';
import {
  writeFileAtomic, cell, CLI_EXIT, makeCliFailWith, acquireTrackerLockForCli,
  loadCanonicalStates, resolveCanonicalState, resolveTrackerPath,
} from './tracker-utils.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

export const MAX_BULK_ROWS = 200;
const EXIT_BATCH_REJECTED = 5;
const { OK: EXIT_OK, USAGE: EXIT_USAGE, NOT_FOUND: EXIT_NOT_FOUND, AMBIGUOUS: EXIT_AMBIGUOUS } = CLI_EXIT;
// Same allow-list as set-status.mjs minus reply-watch: funnel-velocity.mjs only
// accepts these labels, so anything else would be written and then dropped.
const SOURCES = new Set(['set-status', 'web']);

const USAGE = `Usage: node set-status-bulk.mjs --rows N,N[,N...] <state> [--note "..."] [--on YYYY-MM-DD] [--source set-status|web] [--dry-run] [--json]

  --rows N,N[,N...]  Tracker #s (comma-separated, duplicates collapsed, max ${MAX_BULK_ROWS})
  <state>            Canonical state from templates/states.yml (aliases accepted).
                     Hired is refused when more than one row is named.
  --note "..."       Append to each row's Notes cell ("; "-separated, idempotent)
  --on YYYY-MM-DD    Real event date for the status-log entries (default: today)
  --source NAME      Ledger attribution (default: set-status)
  --dry-run          Resolve and validate, write nothing
  --json             Machine-readable output on stdout (errors included)`;

/**
 * Parse comma-separated tracker `#` values: sorted, de-duplicated ids, or an error.
 *
 * @param {string} raw
 * @param {{ max?: number }} [opts]
 * @returns {{ ids: number[] } | { error: string }}
 */
export function parseRowSelection(raw, { max = MAX_BULK_ROWS } = {}) {
  const ids = new Set();
  for (const token of String(raw).split(',')) {
    const s = token.trim();
    if (!/^\d+$/.test(s) || parseInt(s, 10) < 1) return { error: `not a tracker row id: "${s}"` };
    ids.add(parseInt(s, 10));
  }
  if (ids.size > max) return { error: `too many rows: ${ids.size} (max ${max})` };
  return { ids: [...ids].sort((a, b) => a - b) };
}

/**
 * Next Notes cell value. A note counts as present only as a whole "; "-entry,
 * so retries are idempotent (same rule as set-status.mjs).
 *
 * @param {string} existing
 * @param {string} note
 * @returns {{ next: string, appended: boolean }}
 */
export function nextNotesCell(existing, note) {
  const present = existing === note
    || existing.startsWith(`${note}; `)
    || existing.endsWith(`; ${note}`)
    || existing.includes(`; ${note}; `);
  if (present) return { next: existing, appended: false };
  return { next: existing && existing !== '—' && existing !== '-' ? `${existing}; ${note}` : note, appended: true };
}

/**
 * Replace cell payloads on one tracker line, keeping each cell's padding and
 * the line's separator style (pipe or tab), as set-status.mjs does.
 *
 * @param {string} line
 * @param {Record<number, string>} updates - column index → new payload
 * @returns {string}
 */
export function rewriteCells(line, updates) {
  const separator = trackerRowSeparator(line);
  const parts = splitTrackerCells(line);
  for (const [key, value] of Object.entries(updates)) {
    const index = Number(key);
    while (parts.length <= index) parts.push('');
    const original = parts[index] ?? '';
    const trimmed = original.trim();
    if (trimmed) {
      const start = original.indexOf(trimmed);
      parts[index] = original.slice(0, start) + value + original.slice(start + trimmed.length);
    } else if (original.length >= 2) {
      const half = Math.floor(original.length / 2);
      parts[index] = original.slice(0, half) + value + original.slice(half);
    } else {
      parts[index] = ` ${value} `;
    }
  }
  if (separator !== '\t') return parts.join('|');
  const closing = line.trimEnd().endsWith('|');
  return parts[0] + '|' + parts.slice(1, closing ? -1 : undefined).join('\t') + (closing ? '|' + parts.at(-1) : '');
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const failWith = makeCliFailWith(rawArgs.includes('--json'));
  const failUsage = (message) => {
    if (rawArgs.includes('--json')) {
      console.log(JSON.stringify({ error: message, code: 'usage' }));
      console.error(`❌ ${message}`);
    } else {
      console.error(`❌ ${message}\n\n${USAGE}`);
    }
    process.exit(EXIT_USAGE);
  };

  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    console.log(USAGE);
    process.exit(EXIT_OK);
  }

  const flags = { rows: null, note: null, on: null, source: 'set-status', dryRun: false, json: false };
  const VALUE_FLAGS = { '--rows': 'rows', '--note': 'note', '--on': 'on', '--source': 'source' };
  const positional = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    if (a in VALUE_FLAGS) {
      const value = rawArgs[i + 1];
      if (value === undefined || value.startsWith('--')) failUsage(`Missing value for ${a}`);
      flags[VALUE_FLAGS[a]] = value;
      i++;
    } else if (a.startsWith('--note=')) flags.note = a.slice('--note='.length);
    else if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--json') flags.json = true;
    else if (a.startsWith('--')) failUsage(`Unknown flag: ${a}`);
    else positional.push(a);
  }

  if (flags.rows === null) failUsage('--rows is required');
  if (positional.length !== 1) failUsage(`Expected exactly one state after --rows, got ${positional.length}`);
  if (!SOURCES.has(flags.source)) failUsage(`--source expects one of ${[...SOURCES].join(', ')}, got "${flags.source}"`);
  if (flags.on !== null) {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(flags.on) ? new Date(`${flags.on}T00:00:00Z`) : null;
    if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== flags.on) {
      failUsage(`--on expects a real date as YYYY-MM-DD, got "${flags.on}"`);
    }
    if (flags.on > localToday()) failUsage(`--on date is in the future: "${flags.on}"`);
  }
  const selection = parseRowSelection(flags.rows);
  if (selection.error) failUsage(`--rows: ${selection.error}`);

  const CODE_ROOT = dirname(fileURLToPath(import.meta.url));
  const STATES_FILE = join(CODE_ROOT, 'templates/states.yml');
  let states;
  try {
    states = loadCanonicalStates(STATES_FILE);
  } catch (err) {
    failWith(EXIT_USAGE, 'states-error', `Cannot load canonical states from ${STATES_FILE}: ${err.message}`);
  }
  const newStatus = resolveCanonicalState(positional[0], states);
  if (!newStatus) {
    failWith(EXIT_USAGE, 'invalid-state', `"${positional[0]}" is not a canonical state. Valid states: ${states.map(s => s.label).join(' · ')}`);
  }
  // A landed job is one row; marking several Hired at once is almost surely a misclick.
  if (newStatus === 'Hired' && selection.ids.length > 1) failUsage('Hired can only be set on one row at a time');

  const APPS_FILE = resolveTrackerPath(getCareerOpsRoot());
  if (!existsSync(APPS_FILE)) failWith(EXIT_NOT_FOUND, 'no-tracker', `No tracker found at ${APPS_FILE}`);
  const note = flags.note != null ? cell(flags.note) : null;

  const lock = await acquireTrackerLockForCli(APPS_FILE, { dryRun: flags.dryRun, failWith });
  let result;
  try {
    let content;
    try {
      content = readFileSync(APPS_FILE, 'utf-8');
    } catch (err) {
      failWith(EXIT_NOT_FOUND, 'read-failure', `Cannot read tracker at ${APPS_FILE}: ${err.message}`);
    }
    const lines = content.split('\n');
    const parseOptions = { allowTabs: true, allowIndentation: true };
    const colmap = resolveColumns(lines, parseOptions);
    if (note && colmap.notes == null) failWith(EXIT_USAGE, 'no-notes-column', 'Tracker has no Notes column — cannot apply --note');

    const rows = [];
    for (let i = 0; i < lines.length; i++) {
      const row = parseTrackerRow(lines[i], colmap, parseOptions);
      if (row) rows.push({ ...row, lineIdx: i });
    }

    const outcomes = [];
    const planned = [];
    let rejected = false;
    for (const n of selection.ids) {
      const hits = rows.filter(r => r.num === n);
      if (hits.length !== 1) {
        rejected = true;
        outcomes.push(hits.length === 0 ? { kind: 'notFound', n } : { kind: 'ambiguous', n, lines: hits.map(r => r.lineIdx + 1) });
        continue;
      }
      const row = hits[0];
      const statusChanged = row.status !== newStatus;
      const notes = note ? nextNotesCell(row.notes ?? '', note) : { appended: false };
      outcomes.push(statusChanged
        ? { kind: 'changed', n, from: row.status, to: newStatus, noteAppended: notes.appended }
        : { kind: 'unchanged', n, status: row.status, noteAppended: notes.appended });
      planned.push({ row, statusChanged, notes });
    }

    if (rejected) {
      result = { applied: false, reason: 'row-resolution-failed', target: newStatus, source: flags.source, outcomes };
    } else if (flags.dryRun || !planned.some(p => p.statusChanged || p.notes.appended)) {
      result = { applied: true, target: newStatus, source: flags.source, outcomes, trackerWritten: false, ledgerWritten: 0 };
    } else {
      for (const p of planned) {
        const updates = {};
        if (p.statusChanged) updates[colmap.status] = newStatus;
        if (p.notes.appended) updates[colmap.notes] = p.notes.next;
        if (Object.keys(updates).length) lines[p.row.lineIdx] = rewriteCells(lines[p.row.lineIdx], updates);
      }
      try {
        writeFileAtomic(APPS_FILE, lines.join('\n'));
      } catch (err) {
        failWith(EXIT_USAGE, 'write-failure', `Cannot write tracker at ${APPS_FILE}: ${err.message}`);
      }

      // Ledger: same line format as set-status.mjs, inside the lock window.
      const logPath = join(dirname(APPS_FILE), 'status-log.tsv');
      const eventDate = flags.on ?? localToday();
      let ledgerWritten = 0;
      let ledgerWarning;
      for (const p of planned.filter(x => x.statusChanged)) {
        try {
          appendFileSync(logPath, `${p.row.num}\t${eventDate}\t${p.row.status}\t${newStatus}\t${flags.source}\t\n`);
          ledgerWritten++;
        } catch (err) {
          ledgerWarning ??= `status-log append failed (status change itself succeeded): ${err.message}`;
        }
      }
      if (ledgerWarning) console.error(`⚠ ${ledgerWarning}`);
      result = {
        applied: true, target: newStatus, source: flags.source, outcomes, trackerWritten: true, ledgerWritten,
        ...(ledgerWarning ? { ledgerWarning } : {}),
      };
    }
  } finally {
    lock?.release();
  }

  // Follow-up seeding after the lock (seedFollowup re-reads the tracker and
  // takes its own lock), only for rows that actually became Applied.
  if (result.applied && result.trackerWritten && newStatus === 'Applied') {
    const { seedFollowup } = await import('./followup-seed.mjs');
    result.followupsSeeded = [];
    for (const o of result.outcomes.filter(x => x.kind === 'changed')) {
      try {
        const seed = await seedFollowup(o.n, {
          trackerPath: APPS_FILE,
          followupsPath: join(dirname(APPS_FILE), 'follow-ups.md'),
          date: flags.on ?? undefined,
        });
        result.followupsSeeded.push({ n: o.n, seeded: seed.seeded, nextDate: seed.nextDate ?? null });
      } catch (err) {
        console.error(`⚠ follow-up seeding failed for #${o.n} (status change itself succeeded): ${err.message}`);
        result.followupsSeeded.push({ n: o.n, seeded: false, reason: 'error', error: err.message });
      }
    }
  }

  if (flags.json) {
    console.log(JSON.stringify(result));
  } else if (result.applied) {
    const changed = result.outcomes.filter(o => o.kind === 'changed').length;
    console.log(`✅ ${flags.dryRun ? 'would set' : 'set'} ${changed} changed, ${result.outcomes.length - changed} unchanged → ${newStatus}`);
  } else {
    console.error(`❌ batch rejected (${result.reason}) — nothing written`);
    for (const o of result.outcomes) {
      if (o.kind === 'notFound') console.error(`  #${o.n} not found`);
      else if (o.kind === 'ambiguous') console.error(`  #${o.n} ambiguous (lines ${o.lines.join(', ')})`);
    }
  }
  if (result.applied) process.exit(EXIT_OK);
  if (selection.ids.length === 1) process.exit(result.outcomes[0].kind === 'ambiguous' ? EXIT_AMBIGUOUS : EXIT_NOT_FOUND);
  process.exit(EXIT_BATCH_REJECTED);
}

if (isMainModule(import.meta.url)) {
  await main();
}
