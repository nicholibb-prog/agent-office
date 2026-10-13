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

// Dan's #12 FIX: every one of these scored level 1 at 897dffce. Each must floor at 6 or above.
const DAN_GATED: Record<string, string[]> = {
  code: ['code', 'Code', 'CODE', 'fix the code', 'source-code', 'c o d e'],
  money: ['money', 'Money', 'move the money', 'mоney'],
  send: ['send', 'sends', 'Send it', 'resend the note', 's-e-n-d'],
  security: ['security', 'Security', 'review the security notes'],
  password: ['password', 'Password', 'Passwords', 'PASSWORD', 'p@ssword', 'pass-word'],
  passwd: ['passwd', 'edit /etc/passwd'],
  pwd: ['pwd', 'PWD', 'store the pwd'],
  creds: ['creds', 'Creds', 'paste the creds here'],
  token: ['token', 'tokens', 'Token', 't0ken'],
  credential: ['credential', 'credentials', 'Credentials'],
  'api key': ['API key', 'api-key', 'apikey', 'Api Key'],
  email: ['email', 'e-mail', 'E-Mail', 'Emails'],
  push: ['push', 're-push', 'Push', 'git push'],
  wire: ['wire', 'Wire the funds'],
  pay: ['pay', 'Pay the invoice'],
  purchase: ['purchase', 'Purchase a license'],
  delete: ['delete', 'Delete the folder', 'deleted'],
  'rm -rf': ['rm -rf', 'rm -rf /tmp/x', 'RM -RF', 'rm  -rf'],
  deploy: ['deploy', 'Deploy to prod', 'redeploy'],
  merge: ['merge', 'Merge the branch', 'auto-merge'],
  'format disk': ['format disk', 'Format Disk', 'format the disk'],
  'approve the PR': ['approve the PR', 'Approve the pr'],
  'move to trash': ['move to trash', 'Move To Trash'],
  'gift card': ['gift card', 'buy a Gift Card', 'giftcard'],
  reimburse: ['reimburse', 'Reimburse me', 'reimbursement'],
  'cancel subscription': ['cancel subscription', 'Cancel the subscription'],
  unsubscribe: ['unsubscribe', 'Unsubscribe from the list'],
  'call the bank': ['call the bank', 'Call the Bank'],
  'book a flight': ['book a flight', 'Book a Flight to Denver'],
  'apply for loan': ['apply for loan', 'Apply for a loan'],
  'sign the contract': ['sign the contract', 'Sign the Contract'],
  release: ['release', 'Release v2', 'cut the release'],
  'ship it': ['ship it', 'Ship It'],
};

for (const [key, variants] of Object.entries(DAN_GATED)) {
  test(`gated floor >= 6: ${key}`, () => {
    for (const t of variants) {
      const lvl = enforcedLevel(1, t);
      assert.ok(lvl >= 6, `${JSON.stringify(t)} -> ${lvl}`);
      assert.ok(claimRefusal(lvl, 'okkin-fake', 'okkin-fake', policy), t);
    }
  });
}

test('level-7 items stay 7 after the new floor', () => {
  for (const t of ['money', 'send', 'email', 'wire', 'pay', 'purchase', 'delete', 'merge', 'gift card', 'reimburse', 'move to trash']) {
    assert.equal(enforcedLevel(1, t), 7, t);
  }
});

test('benign text stays low after the new floor', () => {
  for (const t of ['water the plants', 'summarise the meeting notes', 'tidy the reading list', 'sort the photo album', 'draft a birthday card', 'plan the picnic menu']) {
    assert.ok(enforcedLevel(1, t) <= 3, t + ' -> ' + enforcedLevel(1, t));
  }
});
