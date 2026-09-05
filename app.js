import { correctWord, isSentenceStart, justCompletedSentence } from './corrections.js';
import { buildDocModel, getCaretGlobalOffset, setCaretGlobalOffset, replaceGlobalRange } from './domtext.js';

const page = document.getElementById('page');

// How many words behind the cursor stay untouched (still "being written").
// A completed sentence (ends in . ! ?) is corrected immediately regardless.
const LAG_WORDS = 4;

let correctedUpTo = 0; // word index already scanned, so we don't re-touch active edits

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

  if (!edits.length) return;

  edits.sort((a, b) => b.start - a.start); // descending, so earlier offsets stay valid
  let caretDelta = 0;
  for (const edit of edits) {
    const delta = replaceGlobalRange(blockInfos, edit.start, edit.end, edit.fixed);
    if (edit.start < caret) caretDelta += delta;
  }

  const fresh = buildDocModel(page);
  setCaretGlobalOffset(page, fresh.blockInfos, caret + caretDelta);
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
document.addEventListener('selectionchange', () => {
  if (document.activeElement === page || page.contains(document.activeElement)) {
    updateToolbarState();
  }
});

document.execCommand('defaultParagraphSeparator', false, 'p');

const zoomSelect = document.getElementById('zoom');
zoomSelect.addEventListener('change', () => {
  document.querySelector('.page-shell').style.transform = `scale(${zoomSelect.value})`;
});

const titleInput = document.getElementById('docTitle');
titleInput.addEventListener('focus', () => titleInput.select());
