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
  assert.equal(events.logs.some(({ message }) => /163/.test(message)), true);
});

test('message router PATCH_MAIL163_ACCOUNT forwards account updates', async () => {
  const events = {
    patched: [],
  };

  const router = api.createMessageRouter({
    patchMail163Account: async (accountId, updates) => {
      events.patched.push({ accountId, updates });
      return {
        id: accountId,
        email: 'pool-run@163.com',
        authCode: 'auth-code',
        ...updates,
      };
    },
  });

  const response = await router.handleMessage({
    type: 'PATCH_MAIL163_ACCOUNT',
    payload: {
      accountId: 'acc-2',
      updates: {
        status: 'success',
        success: true,
        used: true,
      },
    },
  });

  assert.deepStrictEqual(events.patched, [
    {
      accountId: 'acc-2',
      updates: {
        status: 'success',
        success: true,
        used: true,
      },
    },
  ]);
  assert.equal(response.ok, true);
  assert.equal(response.account.id, 'acc-2');
  assert.equal(response.account.status, 'success');
  assert.equal(response.account.success, true);
  assert.equal(response.account.used, true);
});

test('message router AUTO_RUN forwards mail163 start step and persists it when provided', async () => {
  const events = {
    persisted: [],
    states: [],
    starts: [],
  };

  const router = api.createMessageRouter({
    clearStopRequest: () => {},
    getPendingAutoRunTimerPlan: () => null,
    getState: async () => ({
      stepStatuses: {},
      mailProvider: '163',
    }),
    normalizeRunCount: (value) => Number(value) || 1,
    setPersistentSettings: async (updates) => {
      events.persisted.push(updates);
    },
    setState: async (updates) => {
      events.states.push(updates);
    },
    startAutoRunLoop: (totalRuns, options) => {
      events.starts.push({ totalRuns, options });
    },
  });

  const response = await router.handleMessage({
    type: 'AUTO_RUN',
    payload: {
      totalRuns: 3,
      autoRunSkipFailures: true,
      mode: 'restart',
      mail163AutoRunStartStep: 6,
    },
  });

  assert.equal(response.ok, true);
  assert.deepStrictEqual(events.persisted, [
    { mail163AutoRunStartStep: 6 },
  ]);
  assert.deepStrictEqual(events.states, [
    {
      autoRunSkipFailures: true,
      mail163AutoRunStartStep: 6,
    },
  ]);
  assert.deepStrictEqual(events.starts, [
    {
      totalRuns: 3,
      options: {
        autoRunSkipFailures: true,
        mode: 'restart',
        mail163AutoRunStartStep: 6,
      },
    },
  ]);
});
