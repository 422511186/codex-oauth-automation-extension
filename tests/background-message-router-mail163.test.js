const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('background/message-router.js', 'utf8');
const globalScope = {};
const api = new Function('self', `${source}; return self.MultiPageBackgroundMessageRouter;`)(globalScope);

test('message router RETRY_MAIL163_ACCOUNT resets account and selects it as current', async () => {
  const events = {
    logs: [],
    patched: [],
    selected: [],
  };

  const router = api.createMessageRouter({
    addLog: async (message, level) => {
      events.logs.push({ message, level });
    },
    patchMail163Account: async (accountId, updates) => {
      events.patched.push({ accountId, updates });
      return { id: accountId, email: 'pool-run@163.com', ...updates };
    },
    setCurrentMail163Account: async (accountId, options) => {
      events.selected.push({ accountId, options });
      return {
        id: accountId,
        email: 'pool-run@163.com',
        authCode: 'auth-code',
        status: 'idle',
        success: false,
        used: false,
        disabled: false,
        lastError: '',
        lastResultAt: 0,
      };
    },
  });

  const response = await router.handleMessage({
    type: 'RETRY_MAIL163_ACCOUNT',
    payload: { accountId: 'acc-1' },
  });

  assert.deepStrictEqual(events.patched, [
    {
      accountId: 'acc-1',
      updates: {
        status: 'idle',
        success: false,
        used: false,
        disabled: false,
        lastError: '',
        lastResultAt: 0,
      },
    },
  ]);
  assert.deepStrictEqual(events.selected, [
    {
      accountId: 'acc-1',
      options: {
        syncEmail: true,
        markRunning: false,
      },
    },
  ]);
  assert.equal(response.ok, true);
  assert.equal(response.account.email, 'pool-run@163.com');
  assert.equal(events.logs.some(({ message }) => /163 号源已重置为可重试/.test(message)), true);
});
