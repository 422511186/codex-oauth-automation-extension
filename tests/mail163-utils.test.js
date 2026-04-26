const test = require('node:test');
const assert = require('node:assert/strict');
const utils = require('../mail163-utils.js');

test('parseMail163ImportText parses 邮箱 授权码 rows', () => {
  const parsed = utils.parseMail163ImportText(`
demo1@163.com authcode-1
demo2@163.com    authcode-2
invalid-only-email

demo3@163.com\tauthcode-3
  `);

  assert.deepStrictEqual(parsed, [
    { email: 'demo1@163.com', authCode: 'authcode-1' },
    { email: 'demo2@163.com', authCode: 'authcode-2' },
    { email: 'demo3@163.com', authCode: 'authcode-3' },
  ]);
});

test('isMail163AccountRunnable only allows unfinished active accounts', () => {
  assert.equal(utils.isMail163AccountRunnable({
    email: 'demo@163.com',
    authCode: 'authcode',
    status: 'idle',
    success: false,
    disabled: false,
  }), true);

  assert.equal(utils.isMail163AccountRunnable({
    email: 'demo@163.com',
    authCode: 'authcode',
    status: 'running',
    success: false,
    disabled: false,
  }), true);

  assert.equal(utils.isMail163AccountRunnable({
    email: 'demo@163.com',
    authCode: 'authcode',
    status: 'failed',
    success: false,
    disabled: false,
  }), false);

  assert.equal(utils.isMail163AccountRunnable({
    email: 'demo@163.com',
    authCode: 'authcode',
    status: 'stopped',
    success: false,
    disabled: false,
  }), false);

  assert.equal(utils.isMail163AccountRunnable({
    email: 'demo@163.com',
    authCode: 'authcode',
    status: 'success',
    success: true,
    disabled: false,
  }), false);

  assert.equal(utils.isMail163AccountRunnable({
    email: 'demo@163.com',
    authCode: 'authcode',
    status: 'idle',
    success: false,
    disabled: true,
  }), false);
});

test('pickMail163AccountForRun skips failed and stopped accounts', () => {
  const picked = utils.pickMail163AccountForRun([
    { id: 'failed', email: 'failed@163.com', authCode: 'x', status: 'failed', success: false, lastResultAt: 1 },
    { id: 'stopped', email: 'stopped@163.com', authCode: 'x', status: 'stopped', success: false, lastResultAt: 0 },
    { id: 'success', email: 'success@163.com', authCode: 'x', status: 'success', success: true, lastResultAt: 0 },
    { id: 'b', email: 'b@163.com', authCode: 'x', status: 'idle', success: false, lastResultAt: 50, retryCount: 1 },
    { id: 'a', email: 'a@163.com', authCode: 'x', status: 'idle', success: false, lastResultAt: 10, retryCount: 0 },
  ]);

  assert.equal(picked.id, 'a');
});

test('normalizeMail163Account preserves trimmed custom category', () => {
  const normalized = utils.normalizeMail163Account({
    id: 'cat-1',
    email: 'demo@163.com',
    authCode: 'authcode',
    category: '  高权重账号  ',
    status: 'idle',
    success: false,
  });

  assert.equal(normalized.category, '高权重账号');
});
