// When the omnibar reaches past the loaded issues and asks Jira directly.
//
// Too eager and every keystroke becomes a request; too shy and an issue that is
// Done, or assigned to somebody else, simply cannot be found — which is the bug
// this rule exists to fix.

import assert from 'node:assert/strict';
import test from 'node:test';

import { looksLikeIssueKey, shouldLookupRemote } from '../renderer/js/util.js';

test('recognises an issue key in any case, anywhere in the text', () => {
  assert.ok(looksLikeIssueKey('GEN-100'));
  assert.ok(looksLikeIssueKey('gen-100'));
  assert.ok(looksLikeIssueKey('Meetings (GEN-1)'));
  assert.ok(looksLikeIssueKey('see EHW-72 for details'));
});

test('does not mistake ordinary text for a key', () => {
  assert.ok(!looksLikeIssueKey('review'));
  assert.ok(!looksLikeIssueKey('some-thing'));
  assert.ok(!looksLikeIssueKey('2026-07-28'));
  assert.ok(!looksLikeIssueKey(''));
});

test('a single character is never worth a round trip', () => {
  assert.equal(shouldLookupRemote('G', 0), false);
  assert.equal(shouldLookupRemote('', 0), false);
  assert.equal(shouldLookupRemote('  ', 0), false);
});

test('a full local list is left alone', () => {
  assert.equal(shouldLookupRemote('review', 15), false);
  assert.equal(shouldLookupRemote('review', 3), false);
});

test('a thinned-out local list triggers the lookup', () => {
  assert.equal(shouldLookupRemote('review', 2), true);
  assert.equal(shouldLookupRemote('review', 1), true);
  assert.equal(shouldLookupRemote('backplane', 0), true);
});

test('an exact key always triggers it, however many local matches there are', () => {
  // The bug in plain terms: GEN-100 is not in the JQL sources, so filtering the
  // loaded list can never find it no matter how much is loaded.
  assert.equal(shouldLookupRemote('GEN-100', 15), true);
  assert.equal(shouldLookupRemote('gen-100', 99), true);
  assert.equal(shouldLookupRemote('Meetings (GEN-1)', 20), true);
});

test('a long free-text title with no local match still triggers it', () => {
  assert.equal(shouldLookupRemote('Axiom Water Bottle Mechanical Design', 0), true);
});
