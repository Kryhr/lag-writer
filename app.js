import { correctWord } from './corrections.js';

const textarea = document.getElementById('editor');
const lagInput = document.getElementById('lag');
const logEl = document.getElementById('log');

// Words are the whitespace-split tokens of the whole textarea value.
// We keep a "correctedUpTo" word-index so we never re-touch words the user
// is still actively editing (the last `lag` words before the caret).
let correctedUpTo = 0;

function tokenize(text) {
  // Keep delimiters so we can rejoin exactly; only "word" tokens (non-whitespace)
  // count toward the word index.
  const tokens = text.split(/(\s+)/);
  return tokens;
}

function logChange(before, after) {
  if (before === after) return;
  const div = document.createElement('div');
  div.innerHTML = `<b>${before}</b> &rarr; ${after}`;
  logEl.prepend(div);
  while (logEl.children.length > 20) logEl.removeChild(logEl.lastChild);
}

function process() {
  const lag = Math.max(0, parseInt(lagInput.value, 10) || 0);
  const caret = textarea.selectionStart;
  const text = textarea.value;
  const tokens = tokenize(text);

  // word tokens are at even indices (0, 2, 4, ...) since split kept whitespace
  // as the odd-indexed separators.
  const wordIndices = [];
  for (let i = 0; i < tokens.length; i += 2) wordIndices.push(i);
  const totalWords = wordIndices.length;

  // Don't touch the last `lag` words — that's the "still typing this" zone.
  const safeWordCount = Math.max(0, totalWords - lag);

  let changed = false;
  let lengthDelta = 0;

  for (let w = correctedUpTo; w < safeWordCount; w++) {
    const idx = wordIndices[w];
    const original = tokens[idx];
    const fixed = correctWord(original);
    if (fixed !== original) {
      logChange(original, fixed);
      lengthDelta += fixed.length - original.length;
      tokens[idx] = fixed;
      changed = true;
    }
  }

  correctedUpTo = safeWordCount;

  if (changed) {
    const newText = tokens.join('');
    textarea.value = newText;
    textarea.selectionStart = textarea.selectionEnd = caret + lengthDelta;
    flashRecent();
  }
}

function flashRecent() {
  textarea.classList.add('flash');
  setTimeout(() => textarea.classList.remove('flash'), 250);
}

let debounceHandle = null;
textarea.addEventListener('input', () => {
  clearTimeout(debounceHandle);
  debounceHandle = setTimeout(process, 200);
});

// If the user deletes text, totalWords can shrink below correctedUpTo;
// clamp it back so the next pass doesn't just sit stuck skipping everything.
textarea.addEventListener('input', () => {
  const totalWords = textarea.value.split(/\s+/).filter(Boolean).length;
  if (correctedUpTo > totalWords) correctedUpTo = totalWords;
});
