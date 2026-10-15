#!/usr/bin/env node

/**
 * tests/set-status-bulk.test.mjs — set-status-bulk.mjs (local fork bulk writer).
 *
 * Pins the contract the web /api/status route and the dashboard multi-select
 * rely on: all-or-nothing resolution, one atomic write, per-row outcomes in
 * one JSON document, ledger lines for changed rows only, and exit codes.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { localToday } from '../lib/local-today.mjs';
import { ROOT } from './helpers.mjs';
import { parseRowSelection, nextNotesCell, rewriteCells } from '../set-status-bulk.mjs';

const TRACKER = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-06-01 | Acme | Backend Engineer | 4.2/5 | Evaluated | ✅ | [1](../reports/001-acme.md) | strong fit |
| 2 | 2026-06-02 | Globex | Platform Engineer | 4.0/5 | Evaluated | ✅ | [2](../reports/002-globex.md) | — |
| 3 | 2026-06-03 | Initech | Data Engineer | 3.9/5 | Discarded | ❌ | [3](../reports/003-initech.md) | pipeline heavy |
`;

function sandbox(content = TRACKER) {
  const dir = mkdtempSync(join(tmpdir(), 'co-setstatus-bulk-'));
  const tracker = join(dir, 'applications.md');
  writeFileSync(tracker, content);
  return { dir, tracker, lock: join(dir, 'career-ops-merge-tracker-test.lock') };
}

function run(args, sb) {
  const env = { ...process.env, CAREER_OPS_TRACKER: sb.tracker, CAREER_OPS_TRACKER_LOCK: sb.lock };
  try {
    const stdout = execFileSync(process.execPath, [join(ROOT, 'set-status-bulk.mjs'), ...args], {
      cwd: ROOT, env, encoding: 'utf-8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout || '' };
  }
}

const statusOf = (content, n) => content.split('\n').find(l => l.startsWith(`| ${n} |`)).split('|')[6].trim();

test('parseRowSelection sorts, de-duplicates and rejects junk', () => {
  assert.deepEqual(parseRowSelection('3,1,3'), { ids: [1, 3] });
  assert.ok(parseRowSelection('1,x').error);
  assert.ok(parseRowSelection('0').error);
  assert.ok(parseRowSelection('1,,2').error);
  assert.ok(parseRowSelection('1,2,3', { max: 2 }).error);
});

test('nextNotesCell appends idempotently and replaces placeholders', () => {
  assert.deepEqual(nextNotesCell('a', 'b'), { next: 'a; b', appended: true });
  assert.deepEqual(nextNotesCell('a; b', 'b'), { next: 'a; b', appended: false });
  assert.deepEqual(nextNotesCell('—', 'b'), { next: 'b', appended: true });
  assert.deepEqual(nextNotesCell('sent CV', 'sent'), { next: 'sent CV; sent', appended: true });
});

test('rewriteCells keeps padding and tab-separated rows', () => {
  // Index 0 is the slice before the first pipe, as in resolveColumns.
  assert.equal(rewriteCells('| 1 | a | b |', { 3: 'xyz' }), '| 1 | a | xyz |');
  assert.equal(rewriteCells('| 1\ta\tb |', { 3: 'xyz' }), '| 1\ta\txyz |');
});

test('bulk write changes every row atomically and logs only real transitions', () => {
  const sb = sandbox();
  try {
    const r = run(['--rows', '1,2,3', 'Discarded', '--note', 'bulk', '--source', 'web', '--json'], sb);
    assert.equal(r.code, 0);
    const doc = JSON.parse(r.stdout);
    assert.equal(doc.applied, true);
    assert.equal(doc.trackerWritten, true);
    assert.equal(doc.ledgerWritten, 2);
    assert.deepEqual(doc.outcomes.map(o => o.kind), ['changed', 'changed', 'unchanged']);
    const after = readFileSync(sb.tracker, 'utf-8');
    for (const n of [1, 2, 3]) assert.equal(statusOf(after, n), 'Discarded');
    assert.match(after, /\| 2 \|.*\| bulk \|/);
    const log = readFileSync(join(sb.dir, 'status-log.tsv'), 'utf-8').split('\n').filter(Boolean);
    assert.deepEqual(log, [
      `1\t${localToday()}\tEvaluated\tDiscarded\tweb\t`,
      `2\t${localToday()}\tEvaluated\tDiscarded\tweb\t`,
    ]);
    // Re-run is a no-op: nothing written, nothing logged.
    const again = JSON.parse(run(['--rows', '1,2,3', 'Discarded', '--note', 'bulk', '--json'], sb).stdout);
    assert.equal(again.trackerWritten, false);
    assert.equal(readFileSync(join(sb.dir, 'status-log.tsv'), 'utf-8').split('\n').filter(Boolean).length, 2);
  } finally { rmSync(sb.dir, { recursive: true, force: true }); }
});

test('one unknown id rejects the whole batch and writes nothing', () => {
  const sb = sandbox();
  try {
    const r = run(['--rows', '1,99', 'Applied', '--json'], sb);
    assert.equal(r.code, 5);
    const doc = JSON.parse(r.stdout);
    assert.equal(doc.applied, false);
    assert.equal(doc.reason, 'row-resolution-failed');
    assert.deepEqual(doc.outcomes.find(o => o.n === 99), { kind: 'notFound', n: 99 });
    assert.equal(readFileSync(sb.tracker, 'utf-8'), TRACKER);
    assert.equal(existsSync(join(sb.dir, 'status-log.tsv')), false);
  } finally { rmSync(sb.dir, { recursive: true, force: true }); }
});

test('single unknown id exits 2, duplicate # exits 3', () => {
  const sb = sandbox(TRACKER + '| 2 | 2026-06-04 | Umbrella | SRE | 3.5/5 | Evaluated | ❌ | — | dup |\n');
  try {
    assert.equal(run(['--rows', '42', 'Applied', '--json'], sb).code, 2);
    assert.equal(run(['--rows', '2', 'Applied', '--json'], sb).code, 3);
  } finally { rmSync(sb.dir, { recursive: true, force: true }); }
});

test('usage errors: bad state, Hired on many rows, unknown source', () => {
  const sb = sandbox();
  try {
    assert.equal(run(['--rows', '1', 'NotAState', '--json'], sb).code, 1);
    assert.equal(run(['--rows', '1,2', 'Hired', '--json'], sb).code, 1);
    assert.equal(run(['--rows', '1', 'Applied', '--source', 'dashboard', '--json'], sb).code, 1);
    assert.equal(readFileSync(sb.tracker, 'utf-8'), TRACKER);
  } finally { rmSync(sb.dir, { recursive: true, force: true }); }
});

test('dry run resolves but writes nothing', () => {
  const sb = sandbox();
  try {
    const doc = JSON.parse(run(['--rows', '1,2', 'Applied', '--dry-run', '--json'], sb).stdout);
    assert.equal(doc.applied, true);
    assert.equal(doc.trackerWritten, false);
    assert.equal(readFileSync(sb.tracker, 'utf-8'), TRACKER);
  } finally { rmSync(sb.dir, { recursive: true, force: true }); }
});

test('Applied seeds a follow-up for each changed row', () => {
  const sb = sandbox();
  try {
    const doc = JSON.parse(run(['--rows', '1,2', 'Applied', '--json'], sb).stdout);
    assert.equal(doc.applied, true);
    assert.deepEqual(doc.followupsSeeded.map(f => [f.n, f.seeded]), [[1, true], [2, true]]);
    assert.ok(existsSync(join(sb.dir, 'follow-ups.md')));
  } finally { rmSync(sb.dir, { recursive: true, force: true }); }
});
