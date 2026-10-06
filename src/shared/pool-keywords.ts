// Keyword floor for the work pool. Every pass is a straight scan: no nested quantifiers.
// The floor is the highest tier among a few spellings of the same text.
import { casefoldStrip, decodeOnce, domainFloor, foldConfusables, hasAltLatin, spaceFillers, spaceIgnorable, stripIgnorable, wideLatinFloor, type FoldMode } from './pool-fold.js';

const PREFIXES = ['force', 'auto', 'pre', 'git', 're', 'un'];

/** Channels, payment, send, merge, and delete. Any suffix counts. */
const SEVEN = [
  'merge', 'email', 'message', 'post', 'reply', 'slack', 'send', 'pay', 'paid', 'invoice', 'transfer', 'wire',
  'purchase', 'buy', 'spend', 'delet', 'remove', 'wipe', 'dm', 'sms', 'tweet', 'text', 'venmo', 'zelle', 'cashapp',
  'order', 'mail', 'forward', 'money', 'charge', 'donate', 'bitcoin', 'iban', 'erase', 'destroy', 'whatsapp', 'telegram',
];
/** Code, secrets, shell, and network. */
const SIX = [
  'deploy', 'push', 'commit', 'code', 'token', 'password', 'credential', 'auth', 'secret', 'key', 'security', 'network',
  'curl', 'wget', 'http', 'url', 'ssh', 'scp', 'upload', 'exec', 'bash', 'nc', 'ftp',
];
/** Sign-in and a destructive shell word. Code filenames are scored separately. */
const FOUR = ['rm', 'login', 'signin'];

const PHRASES: readonly [string, number][] = [
  ['seed phrase', 7],
  ['drop table', 6],
  ['major files', 6],
];

const EXTS = new Set(['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'py', 'pyw', 'sh', 'bash', 'ps1', 'json', 'env', 'yml', 'yaml', 'rb', 'go', 'rs', 'php', 'sql', 'toml', 'ini', 'xml', 'html', 'htm', 'css', 'vue', 'svelte']);

/** Exact lowercase ASCII words that stay at their own level. Matched on the raw text only. */
const EXACT = new Set(['textbook', 'mailbox', 'author', 'keyboard', 'dmv']);

const STEMS: readonly [string, number][] = [
  ...SEVEN.map((s) => [s, 7] as [string, number]),
  ...SIX.map((s) => [s, 6] as [string, number]),
  ...FOUR.map((s) => [s, 4] as [string, number]),
];

const BY_FIRST = new Map<string, [string, number][]>();
for (const pair of STEMS) {
  const list = BY_FIRST.get(pair[0][0]) ?? [];
  list.push(pair);
  BY_FIRST.set(pair[0][0], list);
}
for (const list of BY_FIRST.values()) list.sort((a, b) => b[1] - a[1]);

function isAsciiWord(cp: number): boolean {
  return (cp >= 48 && cp <= 57) || (cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122);
}

function isUpper(cp: number): boolean {
  return cp >= 65 && cp <= 90;
}

function isLower(cp: number): boolean {
  return cp >= 97 && cp <= 122;
}

const UNICODE_LETTER = /\p{L}/u;

/** Greek, Cyrillic, Cherokee, Lisu, Latin, or some other letter. Null when it is not a letter. */
function letterScript(cp: number): 'latin' | 'greek' | 'cyrillic' | 'cherokee' | 'lisu' | 'other' | null {
  if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) return 'latin';
  if (cp < 0xc0) return null;
  if (cp <= 0x24f) return cp === 0xd7 || cp === 0xf7 ? null : 'latin';
  if (cp >= 0x1e00 && cp <= 0x1eff) return 'latin';
  if (cp >= 0x250 && cp <= 0x2af) return 'latin';
  if ((cp >= 0x370 && cp <= 0x3ff) || (cp >= 0x1f00 && cp <= 0x1fff)) return 'greek';
  if ((cp >= 0x400 && cp <= 0x52f) || (cp >= 0x1c80 && cp <= 0x1c8f) || (cp >= 0x2de0 && cp <= 0x2dff) || (cp >= 0xa640 && cp <= 0xa69f)) return 'cyrillic';
  if ((cp >= 0x13a0 && cp <= 0x13ff) || (cp >= 0xab70 && cp <= 0xabbf)) return 'cherokee';
  if (cp >= 0xa4d0 && cp <= 0xa4ff) return 'lisu';
  if ((cp >= 0x2c60 && cp <= 0x2c7f) || (cp >= 0xa720 && cp <= 0xa7ff)) return 'latin';
  return UNICODE_LETTER.test(String.fromCodePoint(cp)) ? 'other' : null;
}

/** A run of single letters with any non-letter gap between them becomes one word. Longer words stay. */
function collapseLetterSpacing(text: string): string {
  if (!hasSingleLetterGap(text)) return text;
  const parts: { w: boolean; s: string }[] = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const start = i;
    const w = isAsciiWord(text.charCodeAt(i));
    i++;
    while (i < n && isAsciiWord(text.charCodeAt(i)) === w) i++;
    parts.push({ w, s: text.slice(start, i) });
  }
  const out: string[] = [];
  for (let t = 0; t < parts.length; ) {
    const tok = parts[t];
    if (!tok.w || tok.s.length !== 1 || !singleChain(parts, t)) {
      out.push(tok.s);
      t++;
      continue;
    }
    while (t < parts.length && parts[t].w && parts[t].s.length === 1 && singleChain(parts, t)) {
      out.push(parts[t].s);
      const gap = parts[t + 1];
      const nxt = parts[t + 2];
      if (gap && !gap.w && nxt && nxt.w && nxt.s.length === 1) t += 2;
      else {
        t++;
        break;
      }
    }
  }
  return out.join('');
}

function hasSingleLetterGap(text: string): boolean {
  const n = text.length;
  let i = 0;
  while (i < n) {
    if (!isAsciiWord(text.charCodeAt(i))) {
      i++;
      continue;
    }
    const start = i;
    while (i < n && isAsciiWord(text.charCodeAt(i))) i++;
    if (i !== start + 1) continue;
    let j = i;
    while (j < n && !isAsciiWord(text.charCodeAt(j))) j++;
    if (j > i && j < n && isAsciiWord(text.charCodeAt(j)) && (j + 1 === n || !isAsciiWord(text.charCodeAt(j + 1)))) return true;
  }
  return false;
}

function singleChain(parts: { w: boolean; s: string }[], at: number): boolean {
  const left = parts[at - 1];
  const prev = parts[at - 2];
  const right = parts[at + 1];
  const next = parts[at + 2];
  return (!!left && !left.w && !!prev && prev.w && prev.s.length === 1) || (!!right && !right.w && !!next && next.w && next.s.length === 1);
}

function splitCamel(text: string): string {
  let found = false;
  for (let i = 1; i < text.length; i++) {
    const cp = text.charCodeAt(i);
    if (!isUpper(cp)) continue;
    const prev = text.charCodeAt(i - 1);
    const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
    if (isLower(prev) || (prev >= 48 && prev <= 57) || (isUpper(prev) && isLower(next))) {
      found = true;
      break;
    }
  }
  if (!found) return text;
  const out: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const cp = text.charCodeAt(i);
    const prev = i > 0 ? text.charCodeAt(i - 1) : 0;
    const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
    if (i > 0 && isUpper(cp) && (isLower(prev) || (prev >= 48 && prev <= 57) || (isUpper(prev) && isLower(next)))) out.push(' ');
    out.push(text[i]);
  }
  return out.join('');
}

/** 'my-password' and 'user.password' become separate words. */
function spaceSeparators(text: string): string {
  if (!hasSep(text)) return text;
  let out = '';
  let gap = false;
  for (const ch of text) {
    if (ch === '-' || ch === '_' || ch === '.') {
      if (!gap) out += ' ';
      gap = true;
    } else {
      gap = false;
      out += ch;
    }
  }
  return out;
}

/** 'e-mail' and 's-e-n-d' become one word. A leftover '_' is still a break. */
function hasSep(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 45 || c === 95 || c === 46) return true;
  }
  return false;
}

function joinSeparators(text: string): string {
  if (!hasSep(text)) return text;
  const out: string[] = [];
  let lastWord = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if ((c === 45 || c === 95 || c === 46) && lastWord) {
      let j = i;
      while (j < text.length) {
        const d = text.charCodeAt(j);
        if (d !== 45 && d !== 95 && d !== 46) break;
        j++;
      }
      if (j < text.length && isAsciiWord(text.charCodeAt(j))) {
        i = j - 1;
        continue;
      }
    }
    if (c === 95) {
      out.push(' ');
      lastWord = false;
    } else {
      out.push(text[i]);
      lastWord = isAsciiWord(c);
    }
  }
  return out.join('');
}

function applyLeet(text: string, one: 'l' | 'i'): string {
  let out = '';
  let i = 0;
  const chars = [...text];
  while (i < chars.length) {
    const cp = chars[i].codePointAt(0)!;
    if (!isLeetChar(cp)) {
      out += chars[i];
      i++;
      continue;
    }
    let j = i;
    let letters = false;
    let marks = false;
    while (j < chars.length && isLeetChar(chars[j].codePointAt(0)!)) {
      const c = chars[j].codePointAt(0)!;
      if (isLower(c) || isUpper(c)) letters = true;
      if ((c >= 48 && c <= 57) || c === 64 || c === 36) marks = true;
      j++;
    }
    if (letters && marks) {
      for (let k = i; k < j; k++) out += leetChar(chars[k], one);
    } else {
      for (let k = i; k < j; k++) out += chars[k];
    }
    i = j;
  }
  return out;
}

function isLeetChar(cp: number): boolean {
  return isAsciiWord(cp) || cp === 64 || cp === 36;
}

function leetChar(ch: string, one: 'l' | 'i'): string {
  switch (ch) {
    case '0': return 'o';
    case '1': return one;
    case '3': return 'e';
    case '4': return 'a';
    case '5': return 's';
    case '7': return 't';
    case '@': return 'a';
    case '$': return 's';
    default: return ch;
  }
}

function needsLeet(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if ((c >= 48 && c <= 57) || c === 64 || c === 36) return true;
  }
  return false;
}

function stemAt(rest: string): number {
  const list = BY_FIRST.get(rest[0]);
  if (!list) return 0;
  let best = 0;
  for (const [stem, tier] of list) {
    if (tier <= best) continue;
    if (rest.startsWith(stem)) {
      best = tier;
      if (best === 7) return 7;
    }
  }
  return best;
}

function wordTier(word: string): number {
  let best = stemAt(word);
  if (best === 7) return 7;
  for (const prefix of PREFIXES) {
    if (word.length > prefix.length && word.startsWith(prefix)) {
      best = Math.max(best, stemAt(word.slice(prefix.length)));
      if (best === 7) return 7;
    }
  }
  return best;
}

/**
 * Exception words standing alone in the raw text.
 * Ignorables and fillers become spaces. No case, accent, or confusable folding.
 * Only an exact lowercase ASCII word is exempt.
 */
function exactHits(text: string): Set<string> {
  const flat = spaceIgnorable(spaceFillers(text));
  const hits = new Set<string>();
  let word = '';
  let pure = true;
  const end = () => {
    if (pure && EXACT.has(word)) hits.add(word);
    word = '';
    pure = true;
  };
  for (let i = 0; i < flat.length; i++) {
    const c = flat.charCodeAt(i);
    if (c >= 97 && c <= 122) word += flat[i];
    else if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90)) {
      pure = false;
      word += flat[i];
    } else end();
  }
  end();
  return hits;
}

function score(text: string, hits: Set<string>): number {
  let best = 1;
  const flat = squeeze(text);
  for (const [phrase, tier] of PHRASES) if (flat.includes(phrase)) best = Math.max(best, tier);
  let word = '';
  const end = () => {
    if (word && !hits.has(word)) best = Math.max(best, wordTier(word));
    word = '';
  };
  for (let i = 0; i < flat.length; i++) {
    const c = flat.charCodeAt(i);
    if (c > 127) {
      const cp = flat.codePointAt(i)!;
      if (cp > 0xffff) i++;
      end();
    } else if (isAsciiWord(c)) word += flat[i];
    else end();
    if (best === 7) break;
  }
  end();
  if (hasCodeExt(text)) best = Math.max(best, 4);
  return best;
}

function squeeze(text: string): string {
  let out = '';
  let gap = false;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp === 32 || cp === 9 || cp === 10 || cp === 13) {
      if (!gap) out += ' ';
      gap = true;
    } else {
      gap = false;
      out += ch;
    }
  }
  return out;
}

function hasCodeExt(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) !== 46) continue;
    let j = i + 1;
    while (j < text.length && isAsciiWord(text.charCodeAt(j))) j++;
    if (j > i + 1 && (j === text.length || !isAsciiWord(text.charCodeAt(j))) && EXTS.has(text.slice(i + 1, j))) return true;
  }
  return false;
}

/** A Greek, Cyrillic, Cherokee, or Lisu letter, or Latin mixed with another script in one word. */
function scriptFloor(text: string): number {
  let high = false;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 127) {
    high = true;
    break;
  }
  if (!high) return 0;
  let latin = false;
  let other = false;
  let flagged = false;
  const flush = () => {
    if (latin && other) flagged = true;
    latin = false;
    other = false;
  };
  for (const ch of text) {
    const script = letterScript(ch.codePointAt(0)!);
    if (!script) {
      flush();
      continue;
    }
    if (script === 'latin') latin = true;
    else {
      other = true;
      if (script === 'greek' || script === 'cyrillic' || script === 'cherokee' || script === 'lisu') flagged = true;
    }
  }
  flush();
  return flagged ? 4 : 0;
}

function prepared(text: string): string {
  return foldConfusables(stripIgnorable(spaceFillers(text.normalize('NFKC'))));
}

/** A Latin word that still has a non-ASCII letter after folding. */
function latinResidue(text: string): number {
  let high = false;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 127) {
    high = true;
    break;
  }
  if (!high) return 0;
  let latin = false;
  let odd = false;
  let other = false;
  let hit = false;
  const flush = () => {
    if (latin && odd && !other) hit = true;
    latin = false;
    odd = false;
    other = false;
  };
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const script = letterScript(cp);
    if (!script) {
      flush();
      continue;
    }
    if (script === 'latin') {
      latin = true;
      if (cp > 127) odd = true;
    } else other = true;
  }
  flush();
  return hit ? 4 : 0;
}

function lowered(text: string): string {
  return casefoldStrip(text);
}

/**
 * Joined spelling: letter gaps close, and hyphen, underscore, and dot runs between letters close too.
 * This is the form older checks compared.
 */
export function normalizePoolText(text: string): string {
  return joinSeparators(collapseLetterSpacing(lowered(prepared(text))));
}

function scoreFolded(raw: string, hits: Set<string>, mode: FoldMode): number {
  const base = casefoldStrip(raw, mode);
  const spaced = collapseLetterSpacing(casefoldStrip(spaceSeparators(splitCamel(raw)), mode));
  const joined = joinSeparators(collapseLetterSpacing(base));
  let best = Math.max(latinResidue(base), domainFloor(base), score(joined, hits), score(spaced, hits), hasCodeExt(base) ? 4 : 0);
  if (best === 7 || !needsLeet(raw)) return best;
  for (const one of ['l', 'i'] as const) {
    const leet = applyLeet(raw, one);
    const leetBase = casefoldStrip(leet, mode);
    best = Math.max(
      best,
      domainFloor(leetBase),
      score(joinSeparators(collapseLetterSpacing(leetBase)), hits),
      score(collapseLetterSpacing(casefoldStrip(spaceSeparators(splitCamel(leet)), mode)), hits),
    );
    if (best === 7) return 7;
  }
  return best;
}

function scorePrepared(text: string, hits: Set<string>): number {
  const raw = foldConfusables(text);
  let best = Math.max(scriptFloor(text), scoreFolded(raw, hits, 'wide'), wideLatinFloor(raw));
  if (best === 7 || !hasAltLatin(raw)) return best;
  return Math.max(best, scoreFolded(raw, hits, 'a'), scoreFolded(raw, hits, 'e'));
}

function floorOnce(text: string): number {
  const hits = exactHits(text);
  const filled = spaceFillers(text.normalize('NFKC'));
  const deleted = stripIgnorable(filled);
  let best = scorePrepared(deleted, hits);
  if (best === 7) return 7;
  const spaced = spaceIgnorable(filled);
  return spaced === deleted ? best : Math.max(best, scorePrepared(spaced, hits));
}

/** Highest keyword tier. The decoded spelling is scored once, and the higher result wins. */
export function keywordFloor(text: string): number {
  const once = floorOnce(text);
  if (once === 7) return 7;
  const decoded = decodeOnce(text);
  return decoded === text ? once : Math.max(once, floorOnce(decoded));
}
