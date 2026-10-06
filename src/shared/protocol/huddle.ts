// Huddle wire messages. The seat list is who the meeting room and the front desks are using.
// No url field: the local model address is server config, never a message.

import type { CliPresence, OllamaHealth, SeatProviderId } from '../seat-provider.js';
import type { Huddle } from '../huddle.js';

export interface SeatFace {
  id: string;
  provider: SeatProviderId;
  /** Honest label. Never WORKING. */
  label: string;
  /** A reply that actually came back. Null until then. */
  reply: string | null;
}

export interface HuddleFloorState {
  current: Huddle | null;
  past: Huddle[];
  seats: SeatFace[];
  cli: CliPresence;
  ollama: OllamaHealth;
  defaultProvider: 'ollama' | 'bridge';
}

export function emptyHuddleFloor(): HuddleFloorState {
  return {
    current: null,
    past: [],
    seats: [],
    cli: { claude: false, grok: false, 'cursor-agent': false },
    ollama: 'offline',
    defaultProvider: 'bridge',
  };
}

export type HuddleClientMsg =
  | { t: 'huddle.enter' }
  | { t: 'huddle.leave' }
  | { t: 'huddle.invite'; workerId: string }
  | { t: 'huddle.agenda'; agenda: string; context: string }
  | { t: 'huddle.decide'; text: string; owner: string; needsNick: boolean }
  | { t: 'huddle.close' }
  | { t: 'huddle.send' }
  | { t: 'seat.provider'; seatId: string; provider: string };

export type HuddleServerMsg = { t: 'huddle'; state: HuddleFloorState };
