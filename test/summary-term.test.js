// The right-hand side of a JQL `summary ~ "…"` match.
//
// `~` takes a Lucene query, so a stray bracket or quote from whatever someone
// typed does not degrade the search — it fails the whole request with a 400 and
// the search box silently stops finding anything.

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLookupJql, toSummaryTerm } from '../main/jira/client.js';

// A representative slice of a real instance: 74 projects, several of whose keys
// are short, common English words.
const KEYS = ['GEN', 'SG', 'EHW', 'AL', 'IN', 'ON', 'IP', 'EC', 'PONTIS', 'COM'];

test('prefix-matches the last word, so results appear while typing', () => {
  assert.equal(toSummaryTerm('meet'), 'meet*');
  assert.equal(toSummaryTerm('meeting'), 'meeting*');
});

test('only the last word gets the wildcard', () => {
  assert.equal(toSummaryTerm('interview task'), 'interview task*');
  assert.equal(toSummaryTerm('axiom water bottle'), 'axiom water bottle*');
});

test('strips every Lucene operator', () => {
  // "Meeting - Protostar" is the case that started this: the hyphen is a
  // negation operator and would exclude everything after it.
  assert.equal(toSummaryTerm('Meeting - Protostar'), 'Meeting Protostar*');
  assert.equal(toSummaryTerm('a && b || c'), 'a b c*');
  assert.equal(toSummaryTerm('foo (bar) [baz]'), 'foo bar baz*');
  assert.equal(toSummaryTerm('what?'), 'what*');
  assert.equal(toSummaryTerm('50% + 50%'), '50% 50%*');
});

test('a quote cannot break out of the JQL string', () => {
  const term = toSummaryTerm('say "hello" now');
  assert.ok(!term.includes('"'));
  assert.equal(term, 'say hello now*');
});

test('a backslash cannot escape anything', () => {
  const term = toSummaryTerm('path\\to\\thing');
  assert.ok(!term.includes('\\'));
  assert.equal(term, 'path to thing*');
});

test('collapses the whitespace left behind by stripping', () => {
  assert.equal(toSummaryTerm('  a   -  b  '), 'a b*');
});

test('a query made only of operators yields nothing to search for', () => {
  assert.equal(toSummaryTerm('((()))'), null);
  assert.equal(toSummaryTerm('---'), null);
  assert.equal(toSummaryTerm('   '), null);
  assert.equal(toSummaryTerm(''), null);
});

test('keeps characters that carry meaning in a title', () => {
  assert.equal(toSummaryTerm('C2012X5R1C226M125AC'), 'C2012X5R1C226M125AC*');
  assert.equal(toSummaryTerm("client's brief"), "client's brief*");
  assert.equal(toSummaryTerm('sprint #4'), 'sprint #4*');
});

// ── Mixing a keyword with a project key ────────────────────────────────────

test('a single word always searches titles, never a project', () => {
  // GEN is a project key, but "gen" alone has to keep finding General,
  // generator, generate…
  assert.equal(buildLookupJql('gen', KEYS), 'summary ~ "gen*" ORDER BY updated DESC');
  assert.equal(buildLookupJql('meeting', KEYS), 'summary ~ "meeting*" ORDER BY updated DESC');
});

test('a project key beside a keyword scopes the title search to it', () => {
  const expected = 'project IN ("GEN") AND summary ~ "meeting*" ORDER BY updated DESC';
  assert.equal(buildLookupJql('gen meeting', KEYS), expected);
  assert.equal(buildLookupJql('meeting gen', KEYS), expected, 'word order must not matter');
  assert.equal(buildLookupJql('GEN Meeting', KEYS), 'project IN ("GEN") AND summary ~ "Meeting*" ORDER BY updated DESC');
});

test('several project keys widen the filter rather than fighting', () => {
  assert.equal(
    buildLookupJql('gen sg meeting', KEYS),
    'project IN ("GEN", "SG") AND summary ~ "meeting*" ORDER BY updated DESC',
  );
});

test('only project keys means show me those projects', () => {
  assert.equal(buildLookupJql('gen sg', KEYS), 'project IN ("GEN", "SG") ORDER BY updated DESC');
});

test('a repeated key is not repeated in the filter', () => {
  assert.equal(
    buildLookupJql('gen gen meeting', KEYS),
    'project IN ("GEN") AND summary ~ "meeting*" ORDER BY updated DESC',
  );
});

test('the wildcard still lands on the last title word, not on a project key', () => {
  assert.equal(
    buildLookupJql('meeting notes gen', KEYS),
    'project IN ("GEN") AND summary ~ "meeting notes*" ORDER BY updated DESC',
  );
});

test('words that merely resemble a key are left as title text', () => {
  assert.equal(
    buildLookupJql('general meeting', KEYS),
    'summary ~ "general meeting*" ORDER BY updated DESC',
  );
  assert.equal(
    buildLookupJql('genesis review', KEYS),
    'summary ~ "genesis review*" ORDER BY updated DESC',
  );
});

test('with no project list it degrades to a plain title search', () => {
  assert.equal(buildLookupJql('gen meeting', []), 'summary ~ "gen meeting*" ORDER BY updated DESC');
});

test('operators are stripped before any of this happens', () => {
  assert.equal(
    buildLookupJql('gen - meeting', KEYS),
    'project IN ("GEN") AND summary ~ "meeting*" ORDER BY updated DESC',
  );
  assert.equal(buildLookupJql('((()))', KEYS), null);
});

test('a two-word query of short key-like words still scopes, which is the point', () => {
  // "in on" is nonsense as a title search and unambiguous as two project keys.
  assert.equal(buildLookupJql('in on', KEYS), 'project IN ("IN", "ON") ORDER BY updated DESC');
});
