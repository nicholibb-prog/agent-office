// Local CLI: npx tsx scripts/seat-token.ts <issue|rotate|revoke|list> [seat] [--data <dir>]
// "issue" and "rotate" print the new token once to stdout. Nothing else ever prints it.
import path from 'node:path';
import { issueSeatToken, revokeSeatToken, listSeats } from '../src/server/seat-tokens.js';

const args = process.argv.slice(2);
const di = args.indexOf('--data');
const dataDir = di >= 0 ? path.resolve(args[di + 1]) : path.resolve('.agent-office');
const [cmd, seat] = args.filter((_, i) => di < 0 || (i !== di && i !== di + 1));

if ((cmd === 'issue' || cmd === 'rotate') && seat) {
  process.stdout.write(issueSeatToken(dataDir, seat) + '\n');
} else if (cmd === 'revoke' && seat) {
  process.stdout.write(revokeSeatToken(dataDir, seat) ? 'revoked\n' : 'no token\n');
} else if (cmd === 'list') {
  for (const s of listSeats(dataDir)) process.stdout.write(`${s.seat}\t${s.createdAt}\n`);
} else {
  process.stderr.write('usage: seat-token <issue|rotate|revoke|list> [seat] [--data dir]\n');
  process.exit(2);
}
