import { correctWord, isSentenceStart, justCompletedSentence } from './corrections.js';
import {
  buildDocModel, getCaretGlobalOffset, setCaretGlobalOffset,
  replaceGlobalRange, snapshotRange, applySnapshotReplacement,
  wrapRangeAsPending, unwrapPendingSpans,
} from './domtext.js';

const page = document.getElementById('page');

// How many words behind the cursor stay untouched (still "being written").
// A completed sentence (ends in . ! ?) is corrected immediately regardless.
// Live-adjustable via the toolbar's #lagWords select.
let LAG_WORDS = 4;

const SMART_CORRECT_TIMEOUT_MS = 7000;

let correctedUpTo = 0; // word index already scanned, so we don't re-touch active edits
let smartCheckedUpTo = 0; // char offset up through which sentences were already sent to the LLM

// Finds every complete sentence in [fromOffset, caret) that hasn't been
// scanned yet — plural, because fast typing can let more than one sentence
// finish between two debounced passes, and each one still needs its own
// trip to the LLM rather than only the most recently completed one.
function findNewSentences(text, caret, fromOffset) {
  const sentences = [];
  let start = fromOffset;
  while (start < caret && /\s/.test(text[start])) start++;
  for (let i = start; i < caret; i++) {
    if (/[.!?]/.test(text[i])) {
      const end = i + 1;
      if (end > start) sentences.push({ start, end });
      start = end;
      while (start < caret && /\s/.test(text[start])) start++;
    }
  }
  return sentences;
}

function requestSmartCorrection(blockInfos, start, end) {
  // Wrap first so the sentence shows a "checking grammar" squiggly while
  // in flight; the snapshot used for the eventual replacement is derived
  // from the wrapper itself (never captured before wrapping — wrapping can
  // splice/replace the underlying text nodes, which would invalidate a
  // pre-wrap snapshot's saved node/offset handles).
  const wrapped = wrapRangeAsPending(blockInfos, start, end);
  const snap = wrapped ? wrapped.snapshot : snapshotRange(blockInfos, start, end);
  if (!snap || !snap.text.trim()) {
    if (wrapped) unwrapPendingSpans(wrapped.spans);
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SMART_CORRECT_TIMEOUT_MS);

  fetch('/api/correct', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: snap.text }),
    signal: controller.signal,
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (!data || !data.corrected || data.corrected === snap.text) return;
      if (applySnapshotReplacement(snap, data.corrected)) {
        // Offsets past this point may now be off (the replacement can be a
        // different length); a full harmless rescan next keystroke is cheap
        // since both correction passes are idempotent.
        correctedUpTo = 0;
        smartCheckedUpTo = 0;
      }
    })
    .catch(() => {}) // offline/rate-limited/timed out — local-rules pass already ran
    .finally(() => {
      clearTimeout(timeout);
      if (wrapped) unwrapPendingSpans(wrapped.spans);
    });
}

function process() {
  const { text, blockInfos } = buildDocModel(page);
  const caret = getCaretGlobalOffset(blockInfos);
  if (caret === null) return;

  const spans = [...text.matchAll(/\S+/g)].map((m) => ({ start: m.index, end: m.index + m[0].length, word: m[0] }));
  const totalWords = spans.length;
  if (totalWords < correctedUpTo) correctedUpTo = totalWords;

  const sentenceJustEnded = justCompletedSentence(text, caret);
  const safeWordCount = sentenceJustEnded ? totalWords : Math.max(0, totalWords - LAG_WORDS);

  const edits = [];
  for (let w = correctedUpTo; w < safeWordCount; w++) {
    const span = spans[w];
    const sentenceStart = isSentenceStart(text, span.start);
    const fixed = correctWord(span.word, { sentenceStart });
    if (fixed !== span.word) edits.push({ start: span.start, end: span.end, fixed });
  }
  correctedUpTo = safeWordCount;

  let finalBlockInfos = blockInfos;
  let finalCaret = caret;

  if (edits.length) {
    edits.sort((a, b) => b.start - a.start); // descending, so earlier offsets stay valid
    let caretDelta = 0;
    for (const edit of edits) {
      const delta = replaceGlobalRange(blockInfos, edit.start, edit.end, edit.fixed);
      if (edit.start < caret) caretDelta += delta;
    }
    const fresh = buildDocModel(page);
    finalBlockInfos = fresh.blockInfos;
    finalCaret = caret + caretDelta;
    setCaretGlobalOffset(page, finalBlockInfos, finalCaret);
  }

  if (smartCheckedUpTo > finalCaret) smartCheckedUpTo = 0; // e.g. user deleted text
  const fresh = edits.length ? buildDocModel(page) : { text, blockInfos: finalBlockInfos };
  const newSentences = findNewSentences(fresh.text, finalCaret, smartCheckedUpTo);
  for (const s of newSentences) requestSmartCorrection(fresh.blockInfos, s.start, s.end);
  if (newSentences.length) smartCheckedUpTo = newSentences[newSentences.length - 1].end;
}

let debounceHandle = null;
page.addEventListener('input', () => {
  clearTimeout(debounceHandle);
  debounceHandle = setTimeout(process, 150);
});

// --- Toolbar wiring -------------------------------------------------------

// Clicking (or opening a <select> in) the toolbar blurs the contenteditable
// page, which can collapse its selection before a command ever runs. So we
// track the last real selection made *inside* the page and restore it right
// before every command, regardless of what stole focus in between.
let savedRange = null;
document.addEventListener('selectionchange', () => {
  const sel = window.getSelection();
  if (sel.rangeCount && page.contains(sel.anchorNode)) {
    savedRange = sel.getRangeAt(0).cloneRange();
  }
});

function restoreSelection() {
  const sel = window.getSelection();
  if (savedRange) {
    sel.removeAllRanges();
    sel.addRange(savedRange);
  } else {
    page.focus();
  }
}

function cmd(command, value = null) {
  restoreSelection();
  document.execCommand(command, false, value);
  const sel = window.getSelection();
  if (sel.rangeCount) savedRange = sel.getRangeAt(0).cloneRange();
}

// Plain buttons don't need their own mousedown-triggered focus/selection
// change, so keep the page's selection alive rather than losing it early.
document.querySelectorAll('.toolbar button, .topbar button').forEach((btn) => {
  btn.addEventListener('mousedown', (e) => e.preventDefault());
});

document.querySelectorAll('[data-cmd]').forEach((btn) => {
  btn.addEventListener('click', () => {
    cmd(btn.dataset.cmd, btn.dataset.value ?? null);
    updateToolbarState();
  });
});

const fontSizeSelect = document.getElementById('fontSize');
fontSizeSelect.addEventListener('change', () => {
  const px = fontSizeSelect.value;
  restoreSelection();
  const sel = window.getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const span = document.createElement('span');
  span.style.fontSize = px + 'px';
  try {
    range.surroundContents(span);
  } catch {
    document.execCommand('fontSize', false, '3');
  }
  sel.removeAllRanges();
  const after = document.createRange();
  after.selectNodeContents(span);
  after.collapse(false);
  sel.addRange(after);
});

const fontFamilySelect = document.getElementById('fontFamily');
fontFamilySelect.addEventListener('change', () => cmd('fontName', fontFamilySelect.value));

const paragraphStyleSelect = document.getElementById('paragraphStyle');
paragraphStyleSelect.addEventListener('change', () => cmd('formatBlock', paragraphStyleSelect.value));

document.getElementById('linkBtn').addEventListener('click', () => {
  const url = prompt('Link URL:');
  if (url) cmd('createLink', url);
});

document.getElementById('textColor').addEventListener('input', (e) => cmd('foreColor', e.target.value));
document.getElementById('highlightColor').addEventListener('input', (e) => cmd('hiliteColor', e.target.value));

const TOGGLE_COMMANDS = ['bold', 'italic', 'underline', 'strikeThrough', 'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull'];
function updateToolbarState() {
  for (const c of TOGGLE_COMMANDS) {
    const btn = document.querySelector(`[data-cmd="${c}"]`);
    if (!btn) continue;
    btn.classList.toggle('active', document.queryCommandState(c));
  }
}
// selectionchange fires on every caret move — i.e. on every keystroke while
// typing, not just on deliberate selections. updateToolbarState() runs 8
// synchronous (and slow — queryCommandState is a known-heavy legacy API)
// checks, so calling it straight from the event handler made fast typing
// visibly worse the faster it got: each keystroke had to wait for the
// previous one's 8 checks to finish. Coalesce to at most once per frame.
let toolbarStateQueued = false;
function scheduleToolbarStateUpdate() {
  if (toolbarStateQueued) return;
  toolbarStateQueued = true;
  requestAnimationFrame(() => {
    toolbarStateQueued = false;
    updateToolbarState();
  });
}
document.addEventListener('selectionchange', () => {
  if (document.activeElement === page || page.contains(document.activeElement)) {
    scheduleToolbarStateUpdate();
  }
});

document.execCommand('defaultParagraphSeparator', false, 'p');

const lagWordsSelect = document.getElementById('lagWords');
lagWordsSelect.addEventListener('change', () => {
  LAG_WORDS = parseInt(lagWordsSelect.value, 10) || 4;
});

const zoomSelect = document.getElementById('zoom');
zoomSelect.addEventListener('change', () => {
  document.querySelector('.page-shell').style.transform = `scale(${zoomSelect.value})`;
});

const titleInput = document.getElementById('docTitle');
titleInput.addEventListener('focus', () => titleInput.select());
