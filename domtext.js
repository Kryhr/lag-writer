// Maps a contenteditable's rich DOM content to a flat string of global
// character offsets (paragraphs joined by "\n"), and back again, so the
// correction engine can work with plain text while edits land back in the
// right place in the formatted document.

const BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE']);

function* textNodesOf(node) {
  if (node.nodeType === Node.TEXT_NODE) { yield node; return; }
  if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'BR') {
    for (const child of node.childNodes) yield* textNodesOf(child);
  }
}

function textLen(node) {
  let s = 0;
  for (const tn of textNodesOf(node)) s += tn.nodeValue.length;
  return s;
}

// Groups root's direct children into logical "blocks" (paragraphs). Any
// stray inline/text nodes before the first block element are grouped as an
// implicit leading block, matching how browsers actually build up
// contenteditable content before the first Enter press.
function getBlocks(root) {
  const out = [];
  let stray = [];
  for (const child of root.childNodes) {
    if (child.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has(child.tagName)) {
      if (stray.length) { out.push(stray); stray = []; }
      out.push([child]);
    } else {
      stray.push(child);
    }
  }
  if (stray.length) out.push(stray);
  if (out.length === 0) out.push([]);
  return out;
}

function blockText(nodeArray) {
  let s = '';
  for (const n of nodeArray) for (const tn of textNodesOf(n)) s += tn.nodeValue;
  return s;
}

export function buildDocModel(root) {
  const blocks = getBlocks(root);
  let text = '';
  const blockInfos = [];
  blocks.forEach((nodeArray, i) => {
    const t = blockText(nodeArray);
    const start = text.length;
    text += t;
    blockInfos.push({ nodeArray, start, end: start + t.length });
    if (i < blocks.length - 1) text += '\n';
  });
  return { text, blockInfos };
}

// Global character offset of (targetNode, targetOffset) within nodeArray.
function offsetUpTo(nodeArray, targetNode, targetOffset) {
  let total = 0;
  let done = false;
  function walk(node) {
    if (done) return;
    if (node === targetNode) {
      if (node.nodeType === Node.TEXT_NODE) {
        total += targetOffset;
      } else {
        const kids = Array.from(node.childNodes).slice(0, targetOffset);
        for (const k of kids) total += textLen(k);
      }
      done = true;
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      total += node.nodeValue.length;
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'BR') {
      for (const child of node.childNodes) {
        walk(child);
        if (done) return;
      }
    }
  }
  for (const n of nodeArray) {
    walk(n);
    if (done) break;
  }
  return total;
}

function containsNode(nodeArray, target) {
  return nodeArray.some((n) => n === target || (n.contains && n.contains(target)));
}

export function getCaretGlobalOffset(blockInfos) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const bi = blockInfos.find((b) => containsNode(b.nodeArray, range.startContainer));
  if (!bi) return null;
  return bi.start + offsetUpTo(bi.nodeArray, range.startContainer, range.startOffset);
}

function findNodeAtOffset(nodeArray, offset) {
  let remaining = offset;
  for (const n of nodeArray) {
    for (const tn of textNodesOf(n)) {
      if (remaining <= tn.nodeValue.length) return { node: tn, offset: remaining };
      remaining -= tn.nodeValue.length;
    }
  }
  return null;
}

export function setCaretGlobalOffset(root, blockInfos, targetOffset) {
  const bi = blockInfos.find((b) => targetOffset <= b.end) || blockInfos[blockInfos.length - 1];
  const local = Math.max(0, targetOffset - bi.start);
  const found = findNodeAtOffset(bi.nodeArray, local);
  const range = document.createRange();
  if (found) {
    range.setStart(found.node, found.offset);
  } else if (bi.nodeArray.length) {
    range.selectNodeContents(bi.nodeArray[bi.nodeArray.length - 1]);
  } else {
    range.selectNodeContents(root);
  }
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

// Replaces the text in [start, end) — which must lie entirely within one
// block, guaranteed by the caller since word tokens never span the "\n"
// block separator — with `replacement`. Returns the resulting length delta.
export function replaceGlobalRange(blockInfos, start, end, replacement) {
  const bi = blockInfos.find((b) => start >= b.start && end <= b.end);
  if (!bi) return 0;
  const startPos = findNodeAtOffset(bi.nodeArray, start - bi.start);
  const endPos = findNodeAtOffset(bi.nodeArray, end - bi.start);
  if (!startPos || !endPos) return 0;
  const range = document.createRange();
  range.setStart(startPos.node, startPos.offset);
  range.setEnd(endPos.node, endPos.offset);
  range.deleteContents();
  range.insertNode(document.createTextNode(replacement));
  return replacement.length - (end - start);
}

// Captures a range as live DOM node/offset handles (not global char offsets),
// so it can be safely re-applied later — after an async round trip during
// which unrelated edits elsewhere may have shifted every offset in the doc.
export function snapshotRange(blockInfos, start, end) {
  const bi = blockInfos.find((b) => start >= b.start && end <= b.end);
  if (!bi) return null;
  const startPos = findNodeAtOffset(bi.nodeArray, start - bi.start);
  const endPos = findNodeAtOffset(bi.nodeArray, end - bi.start);
  if (!startPos || !endPos) return null;
  const range = document.createRange();
  range.setStart(startPos.node, startPos.offset);
  range.setEnd(endPos.node, endPos.offset);
  return {
    startNode: startPos.node, startOffset: startPos.offset,
    endNode: endPos.node, endOffset: endPos.offset,
    text: range.toString(),
  };
}

// Re-applies a snapshot taken by snapshotRange. Refuses to touch anything if
// the live text there no longer matches what was captured (the user edited
// that spot in the meantime) or the nodes are no longer in the document.
export function applySnapshotReplacement(snapshot, replacement) {
  let range;
  try {
    range = document.createRange();
    range.setStart(snapshot.startNode, snapshot.startOffset);
    range.setEnd(snapshot.endNode, snapshot.endOffset);
  } catch {
    return false;
  }
  if (range.toString() !== snapshot.text) return false;

  const sel = window.getSelection();
  const cur = sel.rangeCount ? sel.getRangeAt(0) : null;
  const caretWasAtEnd = !!cur && cur.collapsed &&
    cur.startContainer === snapshot.endNode && cur.startOffset === snapshot.endOffset;

  range.deleteContents();
  const node = document.createTextNode(replacement);
  range.insertNode(node);

  if (caretWasAtEnd) {
    const after = document.createRange();
    after.setStart(node, node.length);
    after.collapse(true);
    sel.removeAllRanges();
    sel.addRange(after);
  }
  return true;
}

function firstLastTextNode(el) {
  let first = null;
  let last = null;
  for (const tn of textNodesOf(el)) {
    if (!first) first = tn;
    last = tn;
  }
  return { first, last };
}

// Builds a snapshot (same shape as snapshotRange's) from a set of wrapper
// spans, spanning from the first text node of the first span to the last
// text node of the last span. Must be called AFTER wrapping, never before —
// see wrapRangeAsPending's comment for why the order matters.
function snapshotFromWrapped(spans) {
  if (!spans.length) return null;
  const first = firstLastTextNode(spans[0]).first;
  const last = firstLastTextNode(spans[spans.length - 1]).last;
  if (!first || !last) return null;
  const range = document.createRange();
  range.setStart(first, 0);
  range.setEnd(last, last.nodeValue.length);
  return {
    startNode: first, startOffset: 0,
    endNode: last, endOffset: last.nodeValue.length,
    text: range.toString(),
  };
}

// Wraps every text node the range touches individually, each in its own
// clamped sub-range confined to that single node — a range fully inside one
// Text node can never partially-select a non-Text node, so unlike wrapping
// the whole range at once, this can't throw. Used when the whole-range fast
// path in wrapRangeAsPending fails (the range straddles a partial inline
// formatting boundary, e.g. starts mid-way through a <b> run).
function wrapEachTextNode(range, nodeArray, className) {
  // Collect the target nodes fully before mutating anything: surroundContents
  // changes the live tree (a text node's parent changes), and doing that
  // while textNodesOf's generator is still mid-walk over that same tree
  // corrupts its traversal (observed: runaway recursion in textNodesOf).
  const targets = [];
  for (const n of nodeArray) {
    for (const tn of textNodesOf(n)) {
      if (range.intersectsNode(tn)) targets.push(tn);
    }
  }

  const spans = [];
  for (const tn of targets) {
    const subRange = document.createRange();
    subRange.selectNodeContents(tn);
    if (tn === range.startContainer) subRange.setStart(tn, range.startOffset);
    if (tn === range.endContainer) subRange.setEnd(tn, range.endOffset);
    if (subRange.collapsed) continue;
    const span = document.createElement('span');
    span.className = className;
    try {
      subRange.surroundContents(span);
      spans.push(span);
    } catch {
      // skip just this node — degrade gracefully rather than aborting
    }
  }
  return spans;
}

// Wraps [start, end) in one or more <span class="grammar-pending"> markers
// so the UI can show a "pending grammar check" underline while an async
// correction request is in flight, and returns a ready-to-use replacement
// snapshot built from the wrapper(s) themselves. Returns null if nothing
// could be wrapped — callers should fall back to plain snapshotRange in
// that case; the correction still applies correctly, it just won't have a
// visible pending indicator.
//
// Order matters here: the snapshot MUST be derived from the wrapper spans
// AFTER wrapping, never captured beforehand. Range.surroundContents() is
// extract-then-reinsert under the hood — it can splice a text node's data
// shorter or split it into new node objects, which would silently
// invalidate any snapshot captured against the pre-wrap nodes.
export function wrapRangeAsPending(blockInfos, start, end, className = 'grammar-pending') {
  const bi = blockInfos.find((b) => start >= b.start && end <= b.end);
  if (!bi) return null;
  const startPos = findNodeAtOffset(bi.nodeArray, start - bi.start);
  const endPos = findNodeAtOffset(bi.nodeArray, end - bi.start);
  if (!startPos || !endPos) return null;

  const range = document.createRange();
  range.setStart(startPos.node, startPos.offset);
  range.setEnd(endPos.node, endPos.offset);
  if (range.collapsed) return null;

  let spans;
  try {
    const span = document.createElement('span');
    span.className = className;
    range.surroundContents(span);
    spans = [span];
  } catch {
    spans = wrapEachTextNode(range, bi.nodeArray, className);
  }
  if (!spans.length) return null;

  const snapshot = snapshotFromWrapped(spans);
  if (!snapshot) {
    unwrapPendingSpans(spans);
    return null;
  }
  return { spans, snapshot };
}

// Removes wrapper spans created by wrapRangeAsPending, hoisting each span's
// children back to its parent in place. Safe to call unconditionally (e.g.
// from a fetch's .finally()) regardless of outcome: a span whose content
// was already replaced by applySnapshotReplacement is simply no longer in
// the document, so it's skipped rather than erroring.
export function unwrapPendingSpans(spans) {
  for (const span of spans) {
    if (!span.isConnected) continue;
    const parent = span.parentNode;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
  }
}
