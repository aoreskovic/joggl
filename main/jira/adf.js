// Worklog comments — what Jira's own UI calls the Work Description.
//
// In API v3 this field is Atlassian Document Format, not a string. Sending a
// string is rejected, which is why the plugin's `comment: title` never worked and
// why Joggl sent nothing at all until now.
//
// Joggl only ever writes plain text, so the document it builds is the smallest
// legal one. The reader has to cope with whatever colleagues have already written
// through the Jira UI. Across 391 real comments on this site the shapes seen were:
//
//   doc → paragraph → text     391 docs, 401 paragraphs, 398 text nodes
//   hardBreak                    4   newlines happen inside a paragraph
//   text with a link mark        1   marks decorate text, they do not replace it
//   more than one paragraph      5   so paragraphs must be joined, not just read
//
// Hence: write one paragraph with hardBreaks; read by walking the tree for text.

/** A doc whose paragraph is empty — how a comment is cleared. See toAdfComment. */
const EMPTY_DOC = { type: 'doc', version: 1, content: [{ type: 'paragraph' }] };

/**
 * Plain text to the smallest legal ADF document.
 *
 * Newlines become `hardBreak` nodes inside a single paragraph rather than separate
 * paragraphs, which sidesteps the question of whether an empty paragraph is legal
 * in the middle of a doc, and matches what the Jira UI itself produces.
 *
 * @param {string|null|undefined} text
 * @returns {object|null} the document, or null when there is nothing to say —
 *          callers omit the field entirely rather than sending an empty one.
 */
export function toAdfComment(text) {
  const value = String(text ?? '');
  if (!value.trim()) return null;

  // Normalise the line endings a textarea and a paste can both produce.
  const lines = value.replace(/\r\n?/g, '\n').split('\n');

  const content = [];
  for (const [index, line] of lines.entries()) {
    if (index > 0) content.push({ type: 'hardBreak' });
    // A blank line contributes only its break; an empty text node is not legal.
    if (line !== '') content.push({ type: 'text', text: line });
  }

  return { type: 'doc', version: 1, content: [{ type: 'paragraph', content }] };
}

/**
 * The document that clears an existing comment.
 *
 * Omitting `comment` from a PUT leaves whatever Jira already holds, so deleting
 * the text has to send something. Kept separate from `toAdfComment` returning
 * null so the two intentions — "no comment to send" and "remove the comment
 * there is" — cannot be confused at a call site.
 *
 * Verified against the live site rather than assumed: Jira accepts this document
 * and stores it normalised to `content: []`, which `adfToText` reads back as null.
 */
export function emptyAdfComment() {
  return structuredClone(EMPTY_DOC);
}

/**
 * ADF back to plain text.
 *
 * Deliberately forgiving: anything unrecognised is recursed into rather than
 * rejected, so a comment written with formatting Joggl does not offer still shows
 * its words instead of vanishing or rendering as [object Object].
 *
 * @param {object|string|null|undefined} adf
 * @returns {string|null} null when there is no text to show
 */
export function adfToText(adf) {
  if (adf === null || adf === undefined) return null;
  // A v2-shaped comment, or one that has already been flattened.
  if (typeof adf === 'string') return adf.trim() || null;
  if (typeof adf !== 'object') return null;

  const out = [];

  const walk = (node) => {
    if (!node || typeof node !== 'object') return;

    if (node.type === 'text' && typeof node.text === 'string') {
      out.push(node.text);
      return;
    }
    if (node.type === 'hardBreak') {
      out.push('\n');
      return;
    }
    // Alt text is the only words an image or emoji carries.
    if (node.type === 'emoji' && node.attrs?.shortName) {
      out.push(node.attrs.shortName);
      return;
    }
    if (node.type === 'mention' && node.attrs?.text) {
      out.push(node.attrs.text);
      return;
    }

    const children = Array.isArray(node.content) ? node.content : [];
    for (const [index, child] of children.entries()) {
      walk(child);
      // Block-level siblings read as separate lines; inline ones must not be
      // split, or "re" + "viewed" would come back as two lines.
      if (index < children.length - 1 && isBlock(child)) out.push('\n');
    }
  };

  walk(adf);

  const text = out.join('').replace(/\n{3,}/g, '\n\n').trim();
  return text || null;
}

const BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'codeBlock',
  'panel',
  'rule',
  'mediaSingle',
  'mediaGroup',
  'table',
  'tableRow',
]);

function isBlock(node) {
  return Boolean(node) && BLOCK_TYPES.has(node.type);
}
