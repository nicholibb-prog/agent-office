// Folds and decodes for the pool keyword check. Straight scans only: no nested quantifiers.

const CONFUSABLES = new Map<number, string>();

function mapChars(from: string, to: string) {
  const src = [...from];
  const dst = [...to];
  if (src.length !== dst.length) throw new Error('confusable map length');
  for (let i = 0; i < src.length; i++) CONFUSABLES.set(src[i].codePointAt(0)!, dst[i]);
}

// Greek and Cyrillic capitals and lowers that spell Latin words (nu → n, upsilon → y, so TOKEN and KEY survive).
mapChars('ΑΒΕΖΗΙΚΜΝΟΡΤΥΧ', 'ABEZHIKMNOPTYX');
mapChars('αβεζηικμνορτυχ', 'abezhikmnoptyx');
mapChars('АВЕКМНОРСТУХ', 'ABEKMHOPCTYX');
mapChars('авекмнорстух', 'abekmhopctyx');
mapChars('ЅѕІіЈјҺһԀԁ', 'SsIiJjHhDd');
// Lisu SA E NA DA, which spell SEND.
CONFUSABLES.set(0xa4e2, 's');
CONFUSABLES.set(0xa4f0, 'e');
CONFUSABLES.set(0xa4e0, 'n');
CONFUSABLES.set(0xa4d3, 'd');
// Negative squared and negative circled A–Z. NFKC already folds the other enclosed letters.
for (let i = 0; i < 26; i++) {
  const letter = String.fromCharCode(65 + i);
  CONFUSABLES.set(0x1f170 + i, letter);
  CONFUSABLES.set(0x1f150 + i, letter);
}

/** Letters that do not decompose under NFKD, folded after case-fold. Multi-letter targets are ss/ae/oe/th. */
const LATIN_FOLD = new Map<number, string>();
for (const [from, to] of [
  ['ß', 'ss'], ['ø', 'o'], ['đ', 'd'], ['ł', 'l'], ['ı', 'i'], ['æ', 'ae'], ['œ', 'oe'], ['ħ', 'h'], ['ŧ', 't'], ['ɑ', 'a'], ['ɡ', 'g'], ['ĸ', 'k'], ['þ', 'th'],
  ['ᴀ', 'a'], ['ʙ', 'b'], ['ᴄ', 'c'], ['ᴅ', 'd'], ['ᴇ', 'e'], ['ꜰ', 'f'], ['ɢ', 'g'], ['ʜ', 'h'], ['ɪ', 'i'], ['ᴊ', 'j'], ['ᴋ', 'k'], ['ʟ', 'l'], ['ᴍ', 'm'], ['ɴ', 'n'], ['ᴏ', 'o'], ['ᴘ', 'p'], ['ʀ', 'r'], ['ꜱ', 's'], ['ᴛ', 't'], ['ᴜ', 'u'], ['ᴠ', 'v'], ['ᴡ', 'w'], ['ʏ', 'y'], ['ᴢ', 'z'],
] as const) LATIN_FOLD.set(from.codePointAt(0)!, to);

/** Last label of a bare domain. A public suffix wins even when it is also a code extension. */
const TLDS = new Set('com net org edu gov io co uk us de fr nl se no fi au ca br in eu app dev ai xyz info biz me tv cc cloud tech online site gg sh ly ru cn jp kr nz mx it es pl ch be at cz dk sg hk tw'.split(' '));

/** Blank-rendering fillers. These always become a space, so they cannot glue two words. */
const FILLERS = new Set([0x3164, 0xffa0, 0x115f, 0x1160, 0x17b4, 0x17b5, 0x2800]);

export type FoldMode = 'wide' | 'a' | 'e';

const NAMED_ENTITY = new Map([['amp', '&'], ['lt', '<'], ['gt', '>'], ['quot', '"'], ['apos', "'"], ['nbsp', ' ']]);

function hasNonAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 127) return true;
  return false;
}

function isAsciiWord(cp: number): boolean {
  return (cp >= 48 && cp <= 57) || (cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122);
}

/** Format characters and default-ignorable code points. One character class, no nested quantifiers. */
export function stripIgnorable(text: string): string {
  if (!hasNonAscii(text)) return text;
  return text.replace(/[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu, '');
}

/** The same characters, kept as spaces so a word on each side stays two words. */
export function spaceIgnorable(text: string): string {
  if (!hasNonAscii(text)) return text;
  return text.replace(/[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu, ' ');
}

/** Hangul, Khmer, and braille blanks become a space before ignorables are deleted or spaced. */
export function spaceFillers(text: string): string {
  if (!hasNonAscii(text)) return text;
  let out = '';
  let changed = false;
  for (let i = 0; i < text.length; i++) {
    if (FILLERS.has(text.charCodeAt(i))) {
      changed = true;
      out += ' ';
    } else out += text[i];
  }
  return changed ? out : text;
}

export function foldConfusables(text: string): string {
  if (!hasConfusable(text)) return text;
  let out = '';
  for (const ch of text) out += CONFUSABLES.get(ch.codePointAt(0)!) ?? ch;
  return out;
}

function hasConfusable(text: string): boolean {
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    if (CONFUSABLES.has(cp)) return true;
    i += cp > 0xffff ? 2 : 1;
  }
  return false;
}

/** Case-fold first, then drop combining marks, then fold letters NFKD leaves behind. */
export function casefoldStrip(text: string, mode: FoldMode = 'wide'): string {
  const lower = text.toLowerCase();
  if (!hasNonAscii(lower)) return lower;
  return foldLatin(lower.normalize('NFKD').replace(/\p{M}/gu, ''), mode);
}

/** æ, œ, and þ are present, so the single-letter spellings are worth scoring. */
export function hasAltLatin(text: string): boolean {
  if (!hasNonAscii(text)) return false;
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    if (cp === 0xe6 || cp === 0xc6 || cp === 0x153 || cp === 0x152 || cp === 0xfe || cp === 0xde) return true;
    i += cp > 0xffff ? 2 : 1;
  }
  return false;
}

/** A word contained ß, æ, œ, or þ, whose wide fold is two letters. Floor that at 4. */
export function wideLatinFloor(text: string): number {
  if (!hasNonAscii(text)) return 0;
  const lower = text.toLowerCase();
  for (let i = 0; i < lower.length; ) {
    const cp = lower.codePointAt(i)!;
    if (cp === 0xdf || cp === 0xe6 || cp === 0x153 || cp === 0xfe) return 4;
    i += cp > 0xffff ? 2 : 1;
  }
  return 0;
}

function latinPiece(cp: number, mode: FoldMode): string | undefined {
  if (cp === 0xe6) return mode === 'wide' ? 'ae' : mode === 'a' ? 'a' : 'e';
  if (cp === 0x153) return mode === 'wide' ? 'oe' : mode === 'a' ? 'o' : 'e';
  if (cp === 0xfe) return mode === 'wide' ? 'th' : 't';
  return LATIN_FOLD.get(cp);
}

function foldLatin(text: string, mode: FoldMode): string {
  let out = '';
  let changed = false;
  for (const ch of text) {
    const rep = latinPiece(ch.codePointAt(0)!, mode);
    if (rep !== undefined) {
      changed = true;
      out += rep;
    } else out += ch;
  }
  return changed ? out : text;
}

function isHost(cp: number): boolean {
  return isAsciiWord(cp) || cp === 45;
}

function isDot(cp: number): boolean {
  return cp === 46 || cp === 0x3002 || cp === 0xff0e || cp === 0xff61;
}

function isOctet(label: string): boolean {
  if (!label || label.length > 3) return false;
  let n = 0;
  for (let i = 0; i < label.length; i++) {
    const c = label.charCodeAt(i);
    if (c < 48 || c > 57) return false;
    n = n * 10 + (c - 48);
  }
  return n <= 255;
}

/** A bare domain, an IPv4 address, or localhost. A public suffix still counts when it is also a code extension. */
export function domainFloor(text: string): number {
  const n = text.length;
  let i = 0;
  while (i < n) {
    if (!isHost(text.charCodeAt(i))) {
      i++;
      continue;
    }
    if (i > 0 && isHost(text.charCodeAt(i - 1))) {
      while (i < n && isHost(text.charCodeAt(i))) i++;
      continue;
    }
    let labels = 0;
    let last = '';
    let octets = true;
    let local = false;
    while (i < n && isHost(text.charCodeAt(i))) {
      const start = i;
      while (i < n && isHost(text.charCodeAt(i))) i++;
      last = text.slice(start, i);
      labels++;
      if (!isOctet(last)) octets = false;
      if (last === 'localhost') local = true;
      if (i < n && isDot(text.charCodeAt(i)) && i + 1 < n && isHost(text.charCodeAt(i + 1))) {
        i++;
        continue;
      }
      break;
    }
    if (labels === 4 && octets) return 6;
    if (labels === 1 && local) return 6;
    if (labels >= 2 && TLDS.has(last)) return 6;
    if (i < n && isDot(text.charCodeAt(i))) i++;
  }
  return 0;
}

function isHex(cp: number): boolean {
  return (cp >= 48 && cp <= 57) || (cp >= 65 && cp <= 70) || (cp >= 97 && cp <= 102);
}

/** One pass over &#NN; &#xNN; and the basic named entities, plus %XX. Not applied twice. */
export function decodeOnce(text: string): string {
  if (!text.includes('&') && !text.includes('%')) return text;
  let out = '';
  let changed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 38) {
      const ent = readEntity(text, i);
      if (ent) {
        changed = true;
        out += ent.value;
        i = ent.end;
        continue;
      }
    } else if (c === 37 && i + 2 < text.length && isHex(text.charCodeAt(i + 1)) && isHex(text.charCodeAt(i + 2))) {
      changed = true;
      out += String.fromCharCode(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
      continue;
    }
    out += text[i];
  }
  return changed ? out : text;
}

function readEntity(text: string, at: number): { value: string; end: number } | undefined {
  if (text.charCodeAt(at + 1) !== 35) {
    let j = at + 1;
    while (j < text.length && j - at < 8 && isAsciiWord(text.charCodeAt(j))) j++;
    if (text.charCodeAt(j) !== 59) return undefined;
    const name = NAMED_ENTITY.get(text.slice(at + 1, j).toLowerCase());
    return name === undefined ? undefined : { value: name, end: j };
  }
  let j = at + 2;
  let hex = false;
  if (text.charCodeAt(j) === 120 || text.charCodeAt(j) === 88) {
    hex = true;
    j++;
  }
  const start = j;
  const digit = (cp: number) => (hex ? isHex(cp) : cp >= 48 && cp <= 57);
  while (j < text.length && j - start < 7 && digit(text.charCodeAt(j))) j++;
  if (j === start || text.charCodeAt(j) !== 59) return undefined;
  const cp = parseInt(text.slice(start, j), hex ? 16 : 10);
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return undefined;
  return { value: String.fromCodePoint(cp), end: j };
}
