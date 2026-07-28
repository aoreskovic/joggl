// The right-hand side of a JQL `summary ~ "…"` match.
//
// `~` takes a Lucene query, so a stray bracket or quote from whatever someone
// typed does not degrade the search — it fails the whole request with a 400 and
// the search box silently stops finding anything.

import assert from 'node:assert/strict';
import test from 'node:test';

import { toSummaryTerm } from '../main/jira/client.js';

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
