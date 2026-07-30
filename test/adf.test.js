// Worklog comments in Atlassian Document Format.
//
// A string here is rejected by API v3, which is what stopped the plugin logging
// comments at all. The reader has to cope with whatever colleagues already wrote
// through the Jira UI, so the shapes exercised below are the ones actually
// observed on the live site — hardBreak, several paragraphs, and a link mark — not
// invented ones.

import assert from 'node:assert/strict';
import test from 'node:test';

import { adfToText, emptyAdfComment, toAdfComment } from '../main/jira/adf.js';

const doc = (...content) => ({ type: 'doc', version: 1, content });
const para = (...content) => ({ type: 'paragraph', content });
const text = (t) => ({ type: 'text', text: t });

// ── Writing ─────────────────────────────────────────────────────────────────

test('a line of text becomes the smallest legal document', () => {
  assert.deepEqual(
    toAdfComment('reviewed the power section'),
    doc(para(text('reviewed the power section'))),
  );
});

test('never returns a bare string, which is what v3 rejects', () => {
  const built = toAdfComment('anything');
  assert.equal(typeof built, 'object');
  assert.equal(built.type, 'doc');
  assert.equal(built.version, 1);
});

test('nothing to say returns null, so the field can be omitted', () => {
  assert.equal(toAdfComment(''), null);
  assert.equal(toAdfComment('   '), null);
  assert.equal(toAdfComment('\n\n'), null);
  assert.equal(toAdfComment(null), null);
  assert.equal(toAdfComment(undefined), null);
});

test('newlines become hardBreaks inside one paragraph', () => {
  assert.deepEqual(
    toAdfComment('first\nsecond'),
    doc(para(text('first'), { type: 'hardBreak' }, text('second'))),
  );
});

test('a blank line contributes only its break, never an empty text node', () => {
  const built = toAdfComment('a\n\nb');
  const nodes = built.content[0].content;
  // An empty text node is not legal ADF, so there must be none.
  assert.ok(nodes.every((n) => n.type !== 'text' || n.text !== ''));
  assert.equal(adfToText(built), 'a\n\nb');
});

test('CRLF and CR are normalised, so a Windows paste round-trips', () => {
  assert.deepEqual(toAdfComment('a\r\nb'), toAdfComment('a\nb'));
  assert.deepEqual(toAdfComment('a\rb'), toAdfComment('a\nb'));
});

test('the clearing document is distinct from "nothing to send"', () => {
  // Omitting the field on a PUT leaves Jira's comment alone, so clearing needs a
  // document of its own. Confusing the two silently keeps stale text.
  const cleared = emptyAdfComment();
  assert.equal(cleared.type, 'doc');
  assert.equal(adfToText(cleared), null);
  assert.notEqual(cleared, emptyAdfComment(), 'each call returns its own object');
});

// ── Reading ─────────────────────────────────────────────────────────────────

test('reads back what it wrote', () => {
  for (const original of ['one line', 'two\nlines', 'a\n\nb', 'trailing spaces kept  x']) {
    assert.equal(adfToText(toAdfComment(original)), original.trim());
  }
});

test('joins several paragraphs with newlines', () => {
  assert.equal(adfToText(doc(para(text('first')), para(text('second')))), 'first\nsecond');
});

test('does not split text that merely sits in adjacent inline nodes', () => {
  // A link mark splits a sentence into several text nodes. Treating every sibling
  // as a line would turn one sentence into three.
  const linked = doc(
    para(
      text('see '),
      { type: 'text', text: 'the spec', marks: [{ type: 'link', attrs: { href: 'https://x' } }] },
      text(' for details'),
    ),
  );
  assert.equal(adfToText(linked), 'see the spec for details');
});

test('hardBreak reads as a newline', () => {
  assert.equal(adfToText(doc(para(text('a'), { type: 'hardBreak' }, text('b')))), 'a\nb');
});

test('formatting Joggl does not offer still shows its words', () => {
  const rich = doc({
    type: 'bulletList',
    content: [
      { type: 'listItem', content: [para(text('first item'))] },
      { type: 'listItem', content: [para(text('second item'))] },
    ],
  });
  const out = adfToText(rich);
  assert.match(out, /first item/);
  assert.match(out, /second item/);
  assert.ok(!out.includes('[object'), 'never stringifies a node');
});

test('emoji and mentions contribute their text rather than disappearing', () => {
  assert.equal(
    adfToText(doc(para(text('done '), { type: 'emoji', attrs: { shortName: ':tada:' } }))),
    'done :tada:',
  );
  assert.equal(
    adfToText(doc(para(text('with '), { type: 'mention', attrs: { text: '@Marko' } }))),
    'with @Marko',
  );
});

test('an empty or absent comment reads as null', () => {
  assert.equal(adfToText(null), null);
  assert.equal(adfToText(undefined), null);
  // `content: []` is what Jira stores after being sent emptyAdfComment() — checked
  // against the live site, not guessed.
  assert.equal(adfToText(doc()), null);
  assert.equal(adfToText(doc(para())), null);
  assert.equal(adfToText({}), null);
});

test('tolerates a plain string, in case a v2-shaped comment turns up', () => {
  assert.equal(adfToText('already flat'), 'already flat');
  assert.equal(adfToText('   '), null);
});

test('an unknown node with no text does not produce stray blank lines', () => {
  assert.equal(adfToText(doc(para(text('a')), { type: 'rule' }, para(text('b')))), 'a\n\nb');
});
