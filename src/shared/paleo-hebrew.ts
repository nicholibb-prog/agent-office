/**
 * Square Hebrew → Paleo-Hebrew, using the Unicode Phoenician block (U+10900–U+1091F), which Unicode
 * uses for Paleo-Hebrew too. One letter for one letter, in logical (reading) order: the script is
 * right to left, so a renderer draws it with direction 'rtl'. Final forms (ך ם ן ף ץ) map to their
 * base letters: the old script had no final forms. A space becomes the Phoenician word separator
 * (U+1091F), the dot inscriptions put between words.
 */
const BASE = 'אבגדהוזחטיכלמנסעפצקרשת';
const FINAL: Record<string, string> = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
export const PHOENICIAN_WORD_SEPARATOR = '\u{1091F}';

export function toPaleoHebrew(hebrew: string): string {
  let out = '';
  for (const ch of hebrew) {
    if (ch === ' ') { out += PHOENICIAN_WORD_SEPARATOR; continue; }
    const base = FINAL[ch] ?? ch;
    const i = BASE.indexOf(base);
    if (i < 0) throw new Error(`no Paleo-Hebrew letter for ${JSON.stringify(ch)}`);
    out += String.fromCodePoint(0x10900 + i);
  }
  return out;
}

/**
 * 'Victory of the people', as the owner's checklist asks: the full spelling ניצחון העם (with yod and
 * vav), letter for letter into Paleo-Hebrew. The ancient defective spelling would be נצחן העם.
 */
export const VICTORY_OF_THE_PEOPLE = { hebrew: 'ניצחון העם', defective: 'נצחן העם' } as const;
