// Routing funnel v2 (routing-funnel-v2.md §8): the shared shapes. No provider client lives here.

export type Label = 'public' | 'private' | 'secret';
export type Level = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Every destination the router knows. Only 'okkin' is local; everything else is cloud (C3). */
export const CLOUD_PROVIDERS = ['openrouter', 'groq', 'nim', 'glm', 'deepseek', 'forgel', 'polishl', 'grok-crew'] as const;
export type CloudProvider = (typeof CLOUD_PROVIDERS)[number];
export type Provider = 'okkin' | CloudProvider;
/** HTTP model providers (cloudSend's transport); the rest are crew escalations sent by the office. */
export const HTTP_PROVIDERS = ['openrouter', 'groq', 'nim', 'glm', 'deepseek'] as const;
export type HttpProvider = (typeof HTTP_PROVIDERS)[number];
export const CREW_PROVIDERS = ['forgel', 'polishl', 'grok-crew'] as const;
export type CrewProvider = (typeof CREW_PROVIDERS)[number];

export const isCloud = (p: string): p is CloudProvider => (CLOUD_PROVIDERS as readonly string[]).includes(p);
export const isHttpProvider = (p: string): p is HttpProvider => (HTTP_PROVIDERS as readonly string[]).includes(p);

export type Attachment = { name: string; text?: string; binary?: boolean };

/** What goes on the wire to a cloud destination, before serialisation. */
export interface WirePayload {
  model: string;
  system?: string;
  prompt: string;
  history?: { attempt: number; provider: string; result: string; log?: string }[];
  toolResults?: string[];
  attachments?: Attachment[];
  metadata?: Record<string, string | number | boolean>;
}

export interface Attempt {
  attempt: number;
  tier: string;
  provider: Provider;
  model: string;
  result: 'ok' | 'fail' | 'blocked' | 'queued' | 'refused';
  log?: string;
}

export interface Task {
  id: string;
  level: Level;
  /** Ignored for classification: the label comes from config/data-classes.json only (§2). */
  label?: Label;
  repo?: string;
  source?: string;
  /** Where the payload was read from, for the Major Files source check. */
  sourcePath?: string;
  prompt: string;
  estTokens?: number;
  history?: Attempt[];
  /** Task family for the fix-up tax and scoreboard (e.g. 'draft', 'summary', 'code-edit'). */
  type?: string;
  /** Security, money, sends, merges: the gated tier. Never Okkin. */
  gated?: boolean;
  /** Dan-only security task: allowed past the paid cap. */
  danSecurity?: boolean;
  attachments?: Attachment[];
}

export type ScanHitType =
  | 'KEY_PATTERN' | 'HIGH_ENTROPY' | 'PRIVATE_KEY' | 'PASSWORD' | 'DOTENV' | 'EMAIL' | 'PHONE'
  | 'OWNER_NAME' | 'HOME_PATH' | 'MAJOR_FILES' | 'DRIVE_ID' | 'STUDENT' | 'FINANCIAL'
  /** Fail-closed: scanner error, >2 s, >1 MB, or a binary/unextractable attachment. */
  | 'UNSCANNABLE';

/** The only shape a hit is ever logged in (spec §3.3, C5). */
export interface ScanHit { type: ScanHitType; sha8: string; offset_bucket: number }
