// `npm run owner:set`: sets the Okkin owner passphrase, on this machine's terminal only. Prompts twice
// with no echo; stores only a salted scrypt hash in the owner file (0600). The passphrase is never an
// argument, an environment variable, or written anywhere. The running office notices the new hash as
// changed and refuses unlocks until it restarts (see the integrity check in hq/okkin-owner.ts).
import { ownerFile, PASSPHRASE_MIN, setOwnerPassphrase } from '../src/server/hq/okkin-owner.js';

function ask(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let buf = '';
    const done = (fn: () => void) => { stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', on); process.stdout.write('\n'); fn(); };
    const on = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return done(() => resolve(buf));
        if (ch === '\u0003') return done(() => reject(new Error('cancelled')));
        if (ch === '\u007f' || ch === '\b') buf = buf.slice(0, -1);
        else if (ch >= ' ') buf += ch;
      }
    };
    stdin.on('data', on);
  });
}

async function main() {
  if (process.argv.length > 2) { console.error('owner:set takes no arguments (the passphrase is only ever typed at the prompt).'); return 2; }
  if (!process.stdin.isTTY || !process.stdout.isTTY) { console.error('owner:set must be run in a terminal on the office machine.'); return 2; }
  const file = ownerFile();
  console.log(`Okkin owner passphrase (at least ${PASSPHRASE_MIN} characters). Not the office password; never give it to a bot.`);
  const a = await ask('New owner passphrase: ');
  if (a.length < PASSPHRASE_MIN) { console.error(`Too short: at least ${PASSPHRASE_MIN} characters.`); return 1; }
  const b = await ask('Again, to confirm: ');
  if (a !== b) { console.error("They didn't match. Nothing changed."); return 1; }
  await setOwnerPassphrase(file, a);
  console.log(`Saved (hash only) to ${file}. Restart the office, then unlock in Okkin's panel.`);
  return 0;
}

main().then((code) => process.exit(code), (e) => { console.error((e as Error).message); process.exit(1); });
