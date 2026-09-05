// Local, offline correction rules — no API calls, no key needed.
// Each entry maps a lowercase "wrong" word to its fix. Case of the original
// word is preserved on the way back out (see applyWord below).

export const CONTRACTIONS = {
  dont: "don't", wont: "won't", cant: "can't", isnt: "isn't", wasnt: "wasn't",
  arent: "aren't", werent: "weren't", couldnt: "couldn't", shouldnt: "shouldn't",
  wouldnt: "wouldn't", havent: "haven't", hasnt: "hasn't", hadnt: "hadn't",
  didnt: "didn't", doesnt: "doesn't", im: "I'm", ive: "I've", ill: "I'll",
  id: "I'd", youre: "you're", youve: "you've", youll: "you'll", youd: "you'd",
  theyre: "they're", theyve: "they've", theyll: "they'll", theyd: "they'd",
  were: "we're", weve: "we've", well: "we'll", wed: "we'd",
  hes: "he's", shes: "she's", its: "it's", thats: "that's", whats: "what's",
  lets: "let's", whos: "who's",
};

export const SHORTHAND = {
  tbh: "to be honest", lmk: "let me know", idk: "I don't know",
  imo: "in my opinion", imho: "in my honest opinion", btw: "by the way",
  fyi: "for your information", rn: "right now", asap: "as soon as possible",
  omw: "on my way", nvm: "never mind", ngl: "not gonna lie",
  irl: "in real life", afaik: "as far as I know", iirc: "if I recall correctly",
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
};

const ALL_RULES = { ...TYPOS, ...CONTRACTIONS, ...SHORTHAND };

function matchCase(sample, target) {
  if (sample === sample.toUpperCase() && sample !== sample.toLowerCase()) {
    return target.toUpperCase();
  }
  if (sample[0] === sample[0].toUpperCase()) {
    return target[0].toUpperCase() + target.slice(1);
  }
  return target;
}

// Strip leading/trailing punctuation so "pizza." still matches "pizza".
function splitPunct(word) {
  const m = word.match(/^(\W*)(.*?)(\W*)$/s);
  return { lead: m[1], core: m[2], trail: m[3] };
}

export function correctWord(word) {
  const { lead, core, trail } = splitPunct(word);
  if (!core) return word;
  const fix = ALL_RULES[core.toLowerCase()];
  if (!fix) return word;
  return lead + matchCase(core, fix) + trail;
}

export function correctChunk(text) {
  return text
    .split(/(\s+)/)
    .map((token) => (/^\s+$/.test(token) ? token : correctWord(token)))
    .join('');
}
