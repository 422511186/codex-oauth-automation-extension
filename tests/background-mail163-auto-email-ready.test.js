const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('background.js', 'utf8');

function extractLastFunction(name) {
  const markers = [`async function ${name}(`, `function ${name}(`];
  const start = markers
    .map((marker) => source.lastIndexOf(marker))
    .find((index) => index >= 0);
  if (start < 0) {
    throw new Error(`missing function ${name}`);
  }

  let parenDepth = 0;
  let signatureEnded = false;
  let braceStart = -1;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') {
      parenDepth += 1;
    } else if (ch === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        signatureEnded = true;
      }
    } else if (ch === '{' && signatureEnded) {
      braceStart = i;
      break;
    }
  }
  if (braceStart < 0) {
    throw new Error(`missing body for function ${name}`);
  }

  let depth = 0;
  let end = braceStart;
  for (; end < source.length; end += 1) {
    const ch = source[end];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end += 1;
        break;
      }
    }
  }

  return source.slice(start, end);
}

test('ensureAutoEmailReady uses 163 account pool instead of duck generator', async () => {
  const bundle = extractLastFunction('ensureAutoEmailReady');
  const calls = {
    ensureMail163: [],
    fetchGeneratedEmail: 0,
    logs: [],
  };

  const api = new Function('calls', `
const EMAIL_FETCH_MAX_ATTEMPTS = 3;
const CLOUDFLARE_TEMP_EMAIL_GENERATOR = 'cloudflare-temp-email';
const GMAIL_PROVIDER = 'gmail';
async function getState() {
  return {
    mailProvider: '163',
    emailGenerator: 'duck',
    currentMail163AccountId: 'acc-2',
    autoRunLockedMail163AccountId: 'acc-2',
    email: '',
  };
}
function isHotmailProvider() { return false; }
function isLuckmailProvider() { return false; }
function isMail163Provider() { return true; }
function isGeneratedAliasProvider() { return false; }
function isReusableGeneratedAliasEmail() { return false; }
function shouldUseCustomRegistrationEmail() { return false; }
async function ensureHotmailAccountForFlow() { throw new Error('should not call hotmail'); }
async function ensureLuckmailPurchaseForFlow() { throw new Error('should not call luckmail'); }
async function ensureMail2925AccountForFlow() { throw new Error('should not call 2925'); }
async function ensureMail163AccountForFlow(options) {
  calls.ensureMail163.push(options);
  return { id: 'acc-2', email: 'pool@163.com' };
}
function getManagedAliasBaseEmail() { return ''; }
function normalizeEmailGenerator(value) { return String(value || '').trim().toLowerCase(); }
function getEmailGeneratorLabel() { return 'Duck 邮箱'; }
async function fetchGeneratedEmail() {
  calls.fetchGeneratedEmail += 1;
  return 'duck@duck.com';
}
async function addLog(message, level) {
  calls.logs.push({ message, level });
}
async function broadcastAutoRunStatus() {}
async function waitForResume() {}
${bundle}
return { ensureAutoEmailReady };
`)(calls);

  const email = await api.ensureAutoEmailReady(1, 3, 1);
  assert.equal(email, 'pool@163.com');
  assert.deepStrictEqual(calls.ensureMail163, [
    {
      allowAllocate: true,
      preferredAccountId: 'acc-2',
      lockedAccountId: 'acc-2',
      markRunning: true,
    },
  ]);
  assert.equal(calls.fetchGeneratedEmail, 0);
  assert.equal(calls.logs.some(({ message }) => /163 号源/.test(message)), true);
});
