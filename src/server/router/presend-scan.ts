// Pre-send secret & private-data scan (Dan's spec, crew-audit/presend-scan-spec.md; funnel #7).
// Any single hit blocks. Fail closed: an error, >2 s, >1 MB or an unextractable attachment is a block.
// Private literals are only ever SHA-256 hashes (PRESEND_DENY_HASHES_FILE on the ProArt); the repo
// holds generic regexes and fake test hashes only. A hit is reported as {type, sha8, offset_bucket}:
// never the match, the text around it or the payload.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { decodeBase64Tokens, decodeOnce, stripIgnorable } from '../../shared/pool-fold.js';
import { isMajorFiles, underMajorFiles } from '../major-files.js';
import type { Attachment, ScanHit, ScanHitType, WirePayload } from './types.js';

export const MAX_SCAN_BYTES = 1_048_576;
export const SCAN_TIMEOUT_MS = 2000;
export const OFFSET_BUCKET = 1024;

/** Allowlist entries can never exempt these (spec §4). */
export const NEVER_EXEMPT: ReadonlySet<ScanHitType> = new Set(['PRIVATE_KEY', 'OWNER_NAME', 'DRIVE_ID', 'MAJOR_FILES', 'HOME_PATH', 'FINANCIAL', 'UNSCANNABLE']);

export interface DenyHashes {
  owner_name: Set<string>;
  home_user: Set<string>;
  drive_id: Set<string>;
  student: Set<string>;
}
export interface AllowList {
  /** sha256 of the normalised fixture string -> reason (exact entries only; no wildcards). */
  hashes: Set<string>;
  domains: string[];
}
export interface ScanContext {
  deny: DenyHashes;
  allow: AllowList;
  /** `git cat-file -e` in the public repo being worked on. Absent: no git exemption. */
  gitObjectExists?: (sha: string) => boolean;
  /** Source path the payload came from (Major Files check, never opened). */
  sourcePath?: string;
  /** Source labelled `student` in config/data-classes.json. */
  studentSource?: boolean;
  now?: () => number;
}
export interface ScanResult { ok: boolean; hits: ScanHit[] }

export const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
/** The normal form a literal is hashed in (deny and allow lists alike). */
export const normLiteral = (s: string) => stripIgnorable(s.normalize('NFKC')).toLowerCase().replace(/\s+/g, ' ').trim();
export const hashLiteral = (s: string) => sha256(normLiteral(s));

export function emptyDeny(): DenyHashes {
  return { owner_name: new Set(), home_user: new Set(), drive_id: new Set(), student: new Set() };
}
const HEX64 = /^[0-9a-f]{64}$/;
/** Parses a deny-hash file ({owner_name:[sha256…], home_user, drive_id, student}). Bad shape throws (callers fail closed). */
export function parseDenyHashes(json: string): DenyHashes {
  const raw = JSON.parse(json) as Record<string, unknown>;
  const out = emptyDeny();
  for (const k of Object.keys(out) as (keyof DenyHashes)[]) {
    const v = raw[k];
    if (v === undefined) continue;
    if (!Array.isArray(v) || !v.every((h) => typeof h === 'string' && HEX64.test(h))) throw new Error(`deny hashes: ${k} must be sha256 hex`);
    for (const h of v as string[]) out[k].add(h);
  }
  return out;
}
export function loadDenyHashes(file: string | undefined): DenyHashes {
  if (!file) return emptyDeny();
  return parseDenyHashes(readFileSync(file, 'utf8'));
}
export function parseAllowList(json: string): AllowList {
  const raw = JSON.parse(json) as { entries?: { sha256?: unknown; reason?: unknown; owner?: unknown }[]; domains?: unknown };
  const hashes = new Set<string>();
  for (const e of raw.entries ?? []) {
    if (typeof e.sha256 !== 'string' || !HEX64.test(e.sha256) || typeof e.reason !== 'string' || typeof e.owner !== 'string') throw new Error('allowlist: each entry needs sha256, reason, owner');
    hashes.add(e.sha256);
  }
  const domains = Array.isArray(raw.domains) ? raw.domains.filter((d): d is string => typeof d === 'string' && /^[a-z0-9.-]+$/.test(d)) : [];
  return { hashes, domains };
}

/** The published test card numbers: the only FINANCIAL exemption (spec §4). */
const TEST_CARDS = new Set(['4242424242424242', '4000056655665556', '5555555555554444', '378282246310005', '6011111111111117']);

/** Every string in the payload, keys included, joined by newlines: what the detectors read. */
export function payloadText(p: unknown, out: string[] = []): string[] {
  if (typeof p === 'string') out.push(p);
  else if (typeof p === 'number' || typeof p === 'boolean') out.push(String(p));
  else if (Array.isArray(p)) for (const v of p) payloadText(v, out);
  else if (p && typeof p === 'object') for (const [k, v] of Object.entries(p)) { out.push(k); payloadText(v, out); }
  return out;
}
/** The exact wire body. */
export const serialize = (p: WirePayload) => JSON.stringify(p);

/** NFKC, zero-width stripped, entity/percent decoded once, base64 tokens decoded once (appended). */
export function normalizedCopy(text: string): string {
  const nf = stripIgnorable(text.normalize('NFKC'));
  const dec = decodeOnce(nf);
  const b64 = decodeBase64Tokens(dec) + ' ' + decodeBase64Tokens(dec.replace(/-/g, '+').replace(/_/g, '/'));
  return `${dec}\n${b64}`;
}

function entropy(s: string): number {
  const m = new Map<string, number>();
  for (const c of s) m.set(c, (m.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of m.values()) { const p = n / s.length; h -= p * Math.log2(p); }
  return h;
}
function luhn(d: string): boolean {
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = d.charCodeAt(d.length - 1 - i) - 48;
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return sum % 10 === 0;
}
function ibanOk(s: string): boolean {
  const r = (s.slice(4) + s.slice(0, 4)).toUpperCase();
  let rem = 0;
  for (const c of r) {
    const v = c >= 'A' && c <= 'Z' ? String(c.charCodeAt(0) - 55) : c;
    for (const d of v) rem = (rem * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return rem === 1;
}
function abaOk(d: string): boolean {
  const n = [...d].map(Number);
  return (3 * (n[0] + n[3] + n[6]) + 7 * (n[1] + n[4] + n[7]) + (n[2] + n[5] + n[8])) % 10 === 0;
}

const KEY_PATTERNS: RegExp[] = [
  /\bsk-(?:ant-|or-)?[A-Za-z0-9_-]{16,}/g,
  /\bgsk_[A-Za-z0-9]{16,}/g,
  /\bnvapi-[A-Za-z0-9_-]{16,}/g,
  /\bxai-[A-Za-z0-9]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}/g,
  /\bya29\.[0-9A-Za-z_-]{10,}/g,
  /\bxox[abprs]-[0-9A-Za-z-]{10,}/g,
  /\bhf_[A-Za-z0-9]{16,}/g,
  /\bglpat-[A-Za-z0-9_-]{16,}/g,
  /\b(?:sk|rk)_live_[0-9A-Za-z]{10,}/g,
  /\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/gi,
  /\bAuthorization\s*:\s*\S+/gi,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@"]+:[^\s/@"]+@/gi,
  /[?&](?:key|token|sig)=[^&\s"]+/gi,
];
const PRIVATE_KEYS = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/g, /PuTTY-User-Key-File/g, /OPENSSH PRIVATE KEY/g];
const PASSWORDS = [/\b(?:password|passwd|pwd|secret|AGENT_OFFICE_PASSWORD)\s*[:=]\s*\S+/gi, /--password[= ]\S+/gi];
const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;
const PHONES = [/(?<![\d.-])(?:\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?![\d.-])/g, /(?<![\w+])\+\d{10,15}(?!\d)/g];
const HOME_PATHS = [/[A-Za-z]:[\\/]+Users[\\/]+([^\\/\s"']+)/gi, /\/home\/([^/\s"']+)/g, /\/Users\/([^/\s"']+)/g, /%USERPROFILE%/gi];
const MAJOR = [/(?:^|[\\/])\s*major[ _.-]?files\s*(?=[\\/]|$|["'\s])/gim, /\bmajor[_.-]files\b/gi];
const DRIVE_URLS = [/drive\.google\.com\/[^\s"']*folders\/[A-Za-z0-9_-]+/gi, /docs\.google\.com\/[^\s"']*\/d\/[A-Za-z0-9_-]+/gi];
const STUDENT_WORDS = [/\bpreply\b/gi, /\blesson notes\b/gi, /\bstudent:/gi];
const SSH_PUB = /\bssh-(?:rsa|ed25519|dss|ecdsa-sha2-nistp\d+)\s+([A-Za-z0-9+/=]+)/g;

class Hits {
  readonly list: ScanHit[] = [];
  private seen = new Set<string>();
  constructor(private ctx: ScanContext, private deadline: number) {}
  add(type: ScanHitType, match: string, offset: number) {
    const norm = normLiteral(match);
    if (!NEVER_EXEMPT.has(type) && this.ctx.allow.hashes.has(sha256(norm))) return;
    const sha8 = sha256(norm).slice(0, 8);
    const key = `${type}:${sha8}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.list.push({ type, sha8, offset_bucket: Math.floor(Math.max(0, offset) / OFFSET_BUCKET) });
  }
  check() {
    if ((this.ctx.now ?? Date.now)() > this.deadline) throw new ScanTimeout();
  }
}
class ScanTimeout extends Error {}

function each(re: RegExp, text: string, fn: (m: RegExpMatchArray) => void) {
  re.lastIndex = 0;
  for (const m of text.matchAll(re)) fn(m);
}

/** 1- and 2-word windows of lower-case words, with their offsets. */
function windows(text: string): { w: string; at: number }[] {
  const words = [...text.matchAll(/[\p{L}\p{M}\p{N}'’_-]+/gu)].map((m) => ({ w: m[0].toLowerCase().replace(/[’]/g, "'"), at: m.index ?? 0 }));
  const out: { w: string; at: number }[] = [];
  for (let i = 0; i < words.length; i++) {
    out.push(words[i]);
    if (i + 1 < words.length) out.push({ w: `${words[i].w} ${words[i + 1].w}`, at: words[i].at });
  }
  return out;
}

function detect(text: string, ctx: ScanContext, hits: Hits) {
  for (const re of KEY_PATTERNS) each(re, text, (m) => hits.add('KEY_PATTERN', m[0], m.index ?? 0));
  for (const re of PRIVATE_KEYS) each(re, text, (m) => hits.add('PRIVATE_KEY', m[0], m.index ?? 0));
  for (const re of PASSWORDS) each(re, text, (m) => hits.add('PASSWORD', m[0], m.index ?? 0));
  hits.check();

  // DOTENV: 2+ KEY=value lines, or one whose name looks like a credential.
  const envLines = [...text.matchAll(/^([A-Z][A-Z0-9_]{2,})=\S+/gm)];
  if (envLines.length >= 2) hits.add('DOTENV', envLines.map((m) => m[0]).join('\n'), envLines[0].index ?? 0);
  else for (const m of envLines) if (/KEY|TOKEN|SECRET|PASS|AUTH/.test(m[1])) hits.add('DOTENV', m[0], m.index ?? 0);

  // HIGH_ENTROPY (SSH public keys are public; git ids exempt only when they exist in the repo).
  const sshPub = new Set<string>();
  each(SSH_PUB, text, (m) => sshPub.add(m[1]));
  each(/[A-Za-z0-9+/_=-]{20,}/g, text, (m) => {
    const tok = m[0];
    if (sshPub.has(tok)) return;
    const hex = /^[0-9a-fA-F]+$/.test(tok);
    const high = (hex && tok.length >= 32 && entropy(tok) >= 3.0) || (!hex && entropy(tok) >= 4.0);
    if (!high) return;
    if (hex && tok.length <= 40 && ctx.gitObjectExists?.(tok.toLowerCase())) return;
    hits.add('HIGH_ENTROPY', tok, m.index ?? 0);
  });
  hits.check();

  each(EMAIL, text, (m) => {
    const dom = m[1].toLowerCase();
    if (ctx.allow.domains.some((d) => dom === d)) return;
    hits.add('EMAIL', m[0], m.index ?? 0);
  });
  for (const re of PHONES) each(re, text, (m) => {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 15) hits.add('PHONE', m[0], m.index ?? 0);
  });

  for (const re of HOME_PATHS) each(re, text, (m) => hits.add('HOME_PATH', m[0], m.index ?? 0));
  for (const re of MAJOR) each(re, text, (m) => hits.add('MAJOR_FILES', m[0], m.index ?? 0));
  // Any path-looking token with a Major Files segment (isMajorFiles semantics).
  each(/[^\s"']*[\\/][^\s"']*/g, text, (m) => { if (isMajorFiles(m[0])) hits.add('MAJOR_FILES', m[0], m.index ?? 0); });
  hits.check();

  for (const re of DRIVE_URLS) each(re, text, (m) => hits.add('DRIVE_ID', m[0], m.index ?? 0));
  if (ctx.deny.drive_id.size) each(/[A-Za-z0-9_-]{25,60}/g, text, (m) => {
    if (ctx.deny.drive_id.has(sha256(m[0]))) hits.add('DRIVE_ID', m[0], m.index ?? 0);
  });

  for (const re of STUDENT_WORDS) each(re, text, (m) => hits.add('STUDENT', m[0], m.index ?? 0));
  if (ctx.deny.owner_name.size || ctx.deny.student.size || ctx.deny.home_user.size) {
    for (const { w, at } of windows(text)) {
      const h = sha256(w);
      if (ctx.deny.owner_name.has(h)) hits.add('OWNER_NAME', w, at);
      if (ctx.deny.student.has(h)) hits.add('STUDENT', w, at);
      if (ctx.deny.home_user.has(h)) hits.add('HOME_PATH', w, at);
    }
  }
  hits.check();

  // FINANCIAL
  each(/(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g, text, (m) => {
    const d = m[0].replace(/[ -]/g, '');
    if (d.length < 13 || d.length > 19 || TEST_CARDS.has(d)) return;
    if (/^(\d)\1+$/.test(d)) return;
    if (luhn(d)) hits.add('FINANCIAL', d, m.index ?? 0);
  });
  each(/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b/g, text, (m) => { const s = m[0].replace(/ /g, ''); if (ibanOk(s)) hits.add('FINANCIAL', s, m.index ?? 0); });
  each(/\b(?:routing|aba)\b[^\d\n]{0,20}(\d{9})\b/gi, text, (m) => { if (abaOk(m[1])) hits.add('FINANCIAL', m[1], m.index ?? 0); });
  each(/\b(?:acct|account)\s*(?:#|no\.?|number)?\s*:?\s*\d{6,}/gi, text, (m) => hits.add('FINANCIAL', m[0], m.index ?? 0));
  each(/(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)/g, text, (m) => hits.add('FINANCIAL', m[0], m.index ?? 0));
}

function attachmentHits(atts: Attachment[] | undefined, hits: Hits) {
  for (const a of atts ?? []) {
    if (a.binary || typeof a.text !== 'string') hits.add('UNSCANNABLE', `attachment:${a.name}`, 0);
    if (/(^|[\\/])\.env(\.|$)|\.env$/i.test(a.name)) hits.add('DOTENV', a.name, 0);
    if (isMajorFiles(a.name)) hits.add('MAJOR_FILES', a.name, 0);
  }
}

/** Scans one text (already the full wire body). Throws nothing: any failure is a block. */
export function presendScan(text: string, ctx: ScanContext, attachments?: Attachment[]): ScanResult {
  const now = ctx.now ?? Date.now;
  const start = now();
  const hits = new Hits(ctx, start + SCAN_TIMEOUT_MS);
  try {
    if (typeof text !== 'string') throw new Error('not text');
    if (Buffer.byteLength(text, 'utf8') > MAX_SCAN_BYTES) {
      hits.add('UNSCANNABLE', 'oversize', 0);
      return { ok: false, hits: hits.list };
    }
    if (ctx.sourcePath && underMajorFiles(ctx.sourcePath)) hits.add('MAJOR_FILES', 'source', 0);
    if (ctx.studentSource) hits.add('STUDENT', 'source', 0);
    attachmentHits(attachments, hits);
    detect(text, ctx, hits);
    const norm = normalizedCopy(text);
    detect(norm, ctx, hits);
    detect(norm.toLowerCase().replace(/[ \t]+/g, ' '), ctx, hits);
    hits.check();
  } catch {
    hits.add('UNSCANNABLE', 'scanner-failed', 0);
  }
  if (now() - start > SCAN_TIMEOUT_MS && !hits.list.some((h) => h.type === 'UNSCANNABLE')) hits.add('UNSCANNABLE', 'timeout', 0);
  return { ok: hits.list.length === 0, hits: hits.list };
}

/** The full payload: the wire JSON and every string in it (so escaped newlines read as lines). */
export function scanPayload(payload: WirePayload, ctx: ScanContext): ScanResult {
  let wire: string;
  try {
    wire = serialize(payload);
  } catch {
    return { ok: false, hits: [{ type: 'UNSCANNABLE', sha8: sha256('serialize').slice(0, 8), offset_bucket: 0 }] };
  }
  if (Buffer.byteLength(wire, 'utf8') > MAX_SCAN_BYTES) return presendScan(wire, ctx);
  return presendScan(`${wire}\n${payloadText(payload).join('\n')}`, ctx, payload.attachments);
}
