/** Direction controls shown as text, so an override cannot redraw the letters around it. */
const BIDI = new Map<number, string>([
  [0x202a, '⟨LRE⟩'],
  [0x202b, '⟨RLE⟩'],
  [0x202c, '⟨PDF⟩'],
  [0x202d, '⟨LRO⟩'],
  [0x202e, '⟨RLO⟩'],
  [0x2066, '⟨LRI⟩'],
  [0x2067, '⟨RLI⟩'],
  [0x2068, '⟨FSI⟩'],
  [0x2069, '⟨PDI⟩'],
  [0x200e, '⟨LRM⟩'],
  [0x200f, '⟨RLM⟩'],
  [0x061c, '⟨ALM⟩'],
]);

/** Job text for the approval window. Bidi controls become visible markers. */
export function visiblePoolText(text: string): string {
  let out = '';
  let changed = false;
  for (const ch of text) {
    const mark = BIDI.get(ch.codePointAt(0)!);
    if (mark !== undefined) {
      changed = true;
      out += mark;
    } else out += ch;
  }
  return changed ? out : text;
}
