// Local, offline correction rules — no API calls, no key needed.
// Each entry maps a lowercase "wrong" word to its fix. Case of the original
// word is preserved on the way back out (see correctWord below), except
// where a sentence-start capitalization is explicitly requested.

export const CONTRACTIONS = {
  dont: "don't", wont: "won't", cant: "can't", isnt: "isn't", wasnt: "wasn't",
  arent: "aren't", werent: "weren't", couldnt: "couldn't", shouldnt: "shouldn't",
  wouldnt: "wouldn't", havent: "haven't", hasnt: "hasn't", hadnt: "hadn't",
  didnt: "didn't", doesnt: "doesn't", im: "I'm", ive: "I've", ill: "I'll",
  id: "I'd", youre: "you're", youve: "you've", youll: "you'll", youd: "you'd",
  theyre: "they're", theyve: "they've", theyll: "they'll", theyd: "they'd",
  weve: "we've",
  hes: "he's", shes: "she's", thats: "that's", whats: "what's",
  whos: "who's", theres: "there's", heres: "here's",
  wheres: "where's", whens: "when's", mustnt: "mustn't",
  neednt: "needn't", shant: "shan't", aint: "ain't", yall: "y'all",
  oclock: "o'clock",
};

// Deliberately NOT in the table above, even though each is a common
// missing-apostrophe typo: "its"/"were"/"well"/"wed"/"lets"/"ma" are also
// valid standalone words (possessive "its", past-tense "were", "well" as in
// a well of water, "to wed", the verb "lets", "ma" as in mother), so a blind
// dictionary swap would silently break correct sentences. That nuance is
// exactly what the sentence-level LLM pass (see app.js) is for instead.

export const SHORTHAND = {
  tbh: "to be honest", lmk: "let me know", idk: "I don't know",
  imo: "in my opinion", imho: "in my honest opinion", btw: "by the way",
  fyi: "for your information", rn: "right now", asap: "as soon as possible",
  omw: "on my way", nvm: "never mind", ngl: "not gonna lie",
  irl: "in real life", afaik: "as far as I know", iirc: "if I recall correctly",
  smh: "shaking my head", tho: "though", thru: "through", cuz: "because",
  bc: "because", bcuz: "because", gonna: "going to", wanna: "want to",
  gotta: "got to", kinda: "kind of", sorta: "sort of", dunno: "don't know",
  ppl: "people", u: "you", ur: "your", r: "are", pls: "please", plz: "please",
  thx: "thanks", ty: "thank you", np: "no problem", omg: "oh my god",
  brb: "be right back", jk: "just kidding", tbf: "to be fair",
  def: "definitely", prob: "probably", probs: "probably",
  obv: "obviously", obvi: "obviously", rly: "really", srsly: "seriously",
  atm: "at the moment", hbu: "how about you", wbu: "what about you",
  lol: "laughing out loud", lmao: "laughing my ass off", rofl: "rolling on the floor laughing",
  b4: "before", gr8: "great", l8r: "later",
  coulda: "could have", shoulda: "should have", woulda: "would have",
  musta: "must have", outta: "out of", gimme: "give me", lemme: "let me",
  lotta: "a lot of",
};

export const TYPOS = {
  teh: "the", recieve: "receive", becuase: "because", definately: "definitely",
  seperate: "separate", occured: "occurred", untill: "until", wich: "which",
  alot: "a lot", writting: "writing", thier: "their", freind: "friend",
  goverment: "government", enviroment: "environment", suprise: "surprise",
  neccessary: "necessary", accomodate: "accommodate", arguement: "argument",
  concious: "conscious", embarass: "embarrass", existance: "existence",
  grammer: "grammar", independant: "independent", liason: "liaison",
  maintainance: "maintenance", noticable: "noticeable", occassion: "occasion",
  posession: "possession", priviledge: "privilege", publically: "publicly",
  reccommend: "recommend", relevent: "relevant", tommorow: "tomorrow",
  begining: "beginning", calender: "calendar", categoried: "categorized",
  comitted: "committed", definitly: "definitely", diffrent: "different",
  extremly: "extremely", febuary: "february", finaly: "finally",
  happend: "happened", imediately: "immediately",
  intrested: "interested", knowlege: "knowledge", lenght: "length",
  libary: "library", medeval: "medieval", mispell: "misspell",
  origional: "original", peice: "piece", pharoah: "pharaoh",
  posible: "possible", prefered: "preferred", probaly: "probably",
  pronounciation: "pronunciation", questionaire: "questionnaire",
  recomend: "recommend", rythm: "rhythm", secratary: "secretary",
  sincerly: "sincerely", speach: "speech", succesful: "successful",
  suprised: "surprised", supress: "suppress", threshhold: "threshold",
  truely: "truly", twelth: "twelfth", underate: "underrate",
  unfortunatly: "unfortunately", wether: "whether", yeild: "yield",
};

// Acronyms that are unambiguous typed lowercase (none of these have a real
// standalone lowercase-word meaning in English, unlike e.g. "id" — which
// stays mapped to "I'd" in CONTRACTIONS above rather than "ID", since that
// one genuinely is ambiguous).
export const STANDALONE = {
  i: 'I', ai: 'AI', api: 'API', cpu: 'CPU', gpu: 'GPU', url: 'URL',
  faq: 'FAQ', diy: 'DIY', ceo: 'CEO', cfo: 'CFO', cto: 'CTO',
  usa: 'USA', uk: 'UK', eu: 'EU', nasa: 'NASA', fbi: 'FBI', cia: 'CIA',
  dna: 'DNA', rgb: 'RGB', html: 'HTML', css: 'CSS', sql: 'SQL',
  ui: 'UI', ux: 'UX', pdf: 'PDF', gps: 'GPS',
};

const ALL_RULES = { ...TYPOS, ...CONTRACTIONS, ...SHORTHAND, ...STANDALONE };

function matchCase(sample, target) {
  if (sample === sample.toUpperCase() && sample !== sample.toLowerCase()) {
    return target.toUpperCase();
  }
  if (sample[0] === sample[0].toUpperCase()) {
    return target[0].toUpperCase() + target.slice(1);
  }
  return target;
}

function capitalizeFirst(str) {
  for (let i = 0; i < str.length; i++) {
    if (/[a-zA-Z]/.test(str[i])) {
      return str.slice(0, i) + str[i].toUpperCase() + str.slice(i + 1);
    }
  }
  return str;
}

// Strip leading/trailing punctuation so "pizza." still matches "pizza".
function splitPunct(word) {
  const m = word.match(/^(\W*)(.*?)(\W*)$/s);
  return { lead: m[1], core: m[2], trail: m[3] };
}

export function correctWord(word, { sentenceStart = false } = {}) {
  const { lead, core, trail } = splitPunct(word);
  if (!core) return word;
  const fix = ALL_RULES[core.toLowerCase()];
  let result = fix ? matchCase(core, fix) : core;
  if (sentenceStart) result = capitalizeFirst(result);
  return lead + result + trail;
}

// True if the word starting at `spanStart` in `text` begins a new sentence:
// either it's the very first thing in the document, or the nearest preceding
// non-whitespace character is a sentence terminator.
export function isSentenceStart(text, spanStart) {
  let i = spanStart - 1;
  while (i >= 0 && /\s/.test(text[i])) i--;
  if (i < 0) return true;
  return /[.!?]/.test(text[i]);
}

// True if the nearest non-whitespace character before the caret is a
// sentence terminator — used to trigger an immediate full-sentence
// correction pass rather than waiting for the lag window to catch up.
// Skips trailing whitespace so "tomorrow. " (period then space) still
// counts, even if the debounce only fires after both characters landed.
export function justCompletedSentence(text, caretOffset) {
  let i = caretOffset - 1;
  while (i >= 0 && /\s/.test(text[i])) i--;
  if (i < 0) return false;
  return /[.!?]/.test(text[i]);
}
