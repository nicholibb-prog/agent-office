// Fail-closed router flags. Every one defaults OFF; only the exact string "1" turns one on.
// Nothing here reads, stores or logs a key value: a key is "present" when its env var is non-empty.

export interface RouterEnv { [k: string]: string | undefined }

export interface RouterFlags {
  /** (a) OpenRouter route ($10 credit). ON needs ROUTER_OPENROUTER_CREDIT=1 *and* a key in the named env var. */
  openrouter: boolean;
  /** Name of the env var / secret holding the OpenRouter key (never the key itself). */
  openrouterKeyEnv: string;
  /**
   * (b) C1: a secret-labelled task may go to the Grok crew (the owner's call). This relaxes the label
   * gate only: the pre-send scan still blocks every hit, for the Grok crew too.
   */
  c1SecretToGrokCrew: boolean;
  /** (c) C6: the owner has supplied student names / Drive IDs into the ProArt store, so student-sourced tasks may route (to Okkin only). */
  c6StudentDrive: boolean;
  /** ROUTER_ON=1: the router is wired and live. OFF: the office board says "Model routing is off". */
  routerOn: boolean;
  /** ROUTER_DRIFT_FETCH=1: the weekly drift check may GET the public OpenRouter model list. */
  driftFetch: boolean;
  /** ROUTER_KILL=1 halts all paid routing (also settable by file, see budget.ts). */
  kill: boolean;
}

const on = (v: string | undefined) => v === '1';
const ENV_NAME = /^[A-Z][A-Z0-9_]{2,63}$/;

export function readRouterFlags(env: RouterEnv = process.env): RouterFlags {
  const keyEnvRaw = (env.ROUTER_OPENROUTER_KEY_ENV ?? 'OPENROUTER_API_KEY').trim();
  const openrouterKeyEnv = ENV_NAME.test(keyEnvRaw) ? keyEnvRaw : '';
  const keyPresent = !!openrouterKeyEnv && !!env[openrouterKeyEnv]?.trim();
  return {
    openrouter: on(env.ROUTER_OPENROUTER_CREDIT) && keyPresent,
    openrouterKeyEnv,
    c1SecretToGrokCrew: on(env.ROUTER_C1_SECRET_TO_GROK_CREW),
    c6StudentDrive: on(env.ROUTER_C6_STUDENT_DRIVE),
    routerOn: on(env.ROUTER_ON),
    driftFetch: on(env.ROUTER_DRIFT_FETCH),
    kill: on(env.ROUTER_KILL),
  };
}

/** The env var each HTTP provider's key is read from. Missing or empty means that provider is disabled. */
export function keyEnvFor(provider: string, flags: RouterFlags): string | null {
  switch (provider) {
    case 'openrouter': return flags.openrouter ? flags.openrouterKeyEnv : null;
    case 'groq': return 'GROQ_API_KEY';
    case 'nim': return 'NVIDIA_API_KEY';
    case 'glm': return 'GLM_API_KEY';
    case 'deepseek': return 'DEEPSEEK_API_KEY';
    default: return null;
  }
}

export function providerEnabled(provider: string, flags: RouterFlags, env: RouterEnv = process.env): boolean {
  const name = keyEnvFor(provider, flags);
  return !!name && !!env[name]?.trim();
}
