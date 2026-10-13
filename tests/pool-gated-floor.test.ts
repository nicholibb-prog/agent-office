// Gated-tier keyword floor: code, money, sends, accounts, secrets, shell and network land at 6 or 7
// whatever level the poster asks for, so an Okkin id can never claim them. Fake task text only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enforcedLevel, claimRefusal } from '../src/shared/pool.js';

const policy = { okkin: ['okkin-fake'], crew: ['crew-fake'] };

const SIX: string[] = [
  'reset the account for the fake user', 'rotate the apikey in config', 'set up oauth for the demo',
  'clear the session cookie', 'store the private key', 'change the passphrase', 'run sudo apt update',
  'chmod the folder', 'open a powershell window', 'write a shell script', 'run npm install', 'fix the repo',
  'open a pull request on github', 'apply the patch', 'refactor the parser', 'add a webhook', 'set the proxy',
  'open a tunnel', 'check dns records', 'turn on the vpn', 'download the installer', 'call the api',
  'edit the crontab', 'restart docker',
];
const SEVEN: string[] = [
  'issue a refund', 'send the payout', 'move funds from the wallet', 'buy some crypto', 'set up stripe',
  'pay with paypal', 'notify the list', 'publish the post', 'invite the group', 'share the doc outside',
];

test('every gated word floors at 6 or above even when the poster asks for level 1', () => {
  for (const t of SIX) assert.ok(enforcedLevel(1, t) >= 6, t + ' -> ' + enforcedLevel(1, t));
});

test('money and sends floor at 7', () => {
  for (const t of SEVEN) assert.equal(enforcedLevel(1, t), 7, t);
});

test('Okkin is refused every gated task whatever tier was claimed', () => {
  for (const t of [...SIX, ...SEVEN]) {
    assert.ok(claimRefusal(enforcedLevel(2, t), 'okkin-fake', 'okkin-fake', policy), t);
  }
});

test('plain chores stay low', () => {
  for (const t of ['summarise the meeting notes', 'tidy the reading list', 'tag the photos by season']) {
    assert.ok(enforcedLevel(1, t) <= 3, t + ' -> ' + enforcedLevel(1, t));
  }
});
