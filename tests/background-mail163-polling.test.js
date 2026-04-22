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

test('pollMail163VerificationCode polls helper in short single-attempt requests', async () => {
  const bundle = extractLastFunction('pollMail163VerificationCode');
  const calls = {
    ensureOptions: [],
    helperRequests: [],
    sleeps: [],
    logs: [],
  };

  const api = new Function('calls', `
async function ensureMail163AccountForFlow(options) {
  calls.ensureOptions.push(options);
  return { id: 'acc-1', email: 'pool@163.com', authCode: 'auth-code' };
}
async function requestMail163Helper(path, payload, options) {
  calls.helperRequests.push({ path, payload, options });
  if (calls.helperRequests.length === 1) {
    throw new Error('no code found；helper 日志：D:/mail163-helper.log');
  }
  return {
    code: '202123',
    emailTimestamp: 123456,
    mailId: '40',
    usedTimeFallback: true,
    selectionSource: 'time_fallback',
  };
}
async function sleepWithStop(ms) {
  calls.sleeps.push(ms);
}
async function addLog(message, level = 'info') {
  calls.logs.push({ message, level });
}
function throwIfStopped() {}
${bundle}
return { pollMail163VerificationCode };
`)(calls);

  const result = await api.pollMail163VerificationCode(4, {
    currentMail163AccountId: 'acc-1',
    autoRunLockedMail163AccountId: 'acc-1',
  }, {
    filterAfterTimestamp: 1000,
    senderFilters: ['openai'],
    subjectFilters: ['code'],
    excludeCodes: ['111111'],
    maxAttempts: 5,
    intervalMs: 3000,
  });

  assert.deepStrictEqual(calls.ensureOptions, [
    {
      allowAllocate: true,
      preferredAccountId: 'acc-1',
      lockedAccountId: 'acc-1',
      markRunning: false,
    },
  ]);
  assert.equal(calls.helperRequests.length, 2);
  assert.deepStrictEqual(
    calls.helperRequests.map(({ path, payload, options }) => ({
      path,
      maxAttempts: payload.maxAttempts,
      intervalMs: payload.intervalMs,
      timeoutMs: options.timeoutMs,
    })),
    [
      {
        path: '/accounts/poll-code',
        maxAttempts: 1,
        intervalMs: 3000,
        timeoutMs: 25000,
      },
      {
        path: '/accounts/poll-code',
        maxAttempts: 1,
        intervalMs: 3000,
        timeoutMs: 25000,
      },
    ]
  );
  assert.deepStrictEqual(calls.sleeps, [3000]);
  assert.equal(result.code, '202123');
  assert.equal(result.mailId, '40');
  assert.equal(result.usedTimeFallback, true);
  assert.equal(calls.logs.some(({ message }) => /163 helper/.test(message)), true);
});
