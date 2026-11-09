// `npm run dev` server half: the dev password goes in through the environment, not argv.
import { spawn } from 'node:child_process';

const env = { ...process.env, AGENT_OFFICE_PASSWORD: process.env.AGENT_OFFICE_PASSWORD || 'dev' };
const child = spawn('tsx', ['watch', 'src/server/cli.ts', '--port', '4600', '--no-open'], { stdio: 'inherit', env, shell: process.platform === 'win32' });
child.on('exit', (code, signal) => (signal ? process.kill(process.pid, signal) : process.exit(code ?? 0)));
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => child.kill(s));
