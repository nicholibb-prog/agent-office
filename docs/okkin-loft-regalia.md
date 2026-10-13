# Okkin's loft: pedestal, sign, scroll and inscription

All procedural geometry and canvas text textures (`src/client/features/okkin-loft/regalia.ts`).
Palette: marble and stone, gold leaf, deep blue (`LOFT_PALETTE`).

## Fonts (bundled, local subsets; nothing fetched at runtime)

| File | Font | Subset | Licence |
| --- | --- | --- | --- |
| `fonts/cinzel-okkin.ttf` | Cinzel, weight 700 (The Cinzel Project Authors) | O K I N | SIL OFL 1.1, `fonts/OFL-Cinzel.txt` |
| `fonts/yuji-syuku-nikko.ttf` | Yuji Syuku (The Yuji Project Authors), brush style | 日 光 | SIL OFL 1.1, `fonts/OFL-YujiSyuku.txt` |
| `fonts/noto-sans-phoenician.ttf` | Noto Sans Phoenician (The Noto Project Authors) | U+10900–U+1091F | SIL OFL 1.1, `fonts/OFL-NotoSansPhoenician.txt` |

None of the three licences declares a Reserved Font Name, so the subsets keep their names.
Subsets were made with fontTools `pyftsubset` (Cinzel instanced at wght 700 first).

## The OKKIN sign

Classical inscriptional capitals (Cinzel) in gold leaf on a marble tablet, with a Greek-key
(meander) border, spaced evenly like a stoichedon inscription. Cinzel draws on classical
inscriptional letterforms; the five letters O K K I N have the same shapes as the Greek
capitals Ο Κ Κ Ι Ν.

## 日光 (Nikko) scroll

A kakejiku: dark lacquer panel in a deep-blue brocade mount, gold brush kanji (Yuji Syuku)
top to bottom, wooden rollers with gold caps and silk tassels, on a slim stone stand. The red seal is a plain
square: no characters are invented.

## Inscription on the pedestal: "victory of the people"

- Spelling: **ניצחון העם**, the full (modern) spelling, as the owner's latest checklist asks. It
  replaces the earlier choice of the ancient defective spelling נצחן העם (no yod, no vav for the
  -ōn ending, as Iron Age inscriptions wrote it; the Samaria ostraca spell Šomrōn as שמרן).
- Script: Paleo-Hebrew, encoded in the Unicode Phoenician block (U+10900–U+1091F), which
  Unicode uses for Paleo-Hebrew, and drawn right to left (canvas `direction = 'rtl'`, logical order).
- Mapping (`src/shared/paleo-hebrew.ts`, tested): letter for letter; final forms map to the base
  letters (ן → נ, ם → מ; also ך ף ץ); the space becomes the word separator U+1091F.
  נ U+1090D · י U+10909 · צ U+10911 · ח U+10907 · ו U+10905 · ן→נ U+1090D · (sep U+1091F) · ה U+10904 · ע U+1090F · ם→מ U+1090C.
- Chiselled look: each letter is drawn as a dark cut with a lit lower lip and a faint gold fill.
