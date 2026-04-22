const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const signupFlowSource = fs.readFileSync('background/signup-flow-helpers.js', 'utf8');
const signupFlowGlobalScope = {};
const signupFlowApi = new Function('self', `${signupFlowSource}; return self.MultiPageSignupFlowHelpers;`)(signupFlowGlobalScope);

test('signup flow helper allocates 163 account before registration when provider is 163', async () => {
  const calls = {
    ensureMail163: [],
    setEmail: [],
  };

  const helpers = signupFlowApi.createSignupFlowHelpers({
    buildGeneratedAliasEmail: () => 'unused@example.com',
    chrome: { tabs: { get: async () => ({ id: 1, url: 'https://auth.openai.com/create-account/password' }) } },
    ensureContentScriptReadyOnTab: async () => {},
    ensureHotmailAccountForFlow: async () => ({}),
    ensureMail163AccountForFlow: async (options) => {
      calls.ensureMail163.push(options);
      return { id: 'acc-5', email: 'pool-run@163.com' };
    },
    ensureMail2925AccountForFlow: async () => ({}),
    ensureLuckmailPurchaseForFlow: async () => ({}),
    isGeneratedAliasProvider: () => false,
    isReusableGeneratedAliasEmail: () => false,
    isHotmailProvider: () => false,
    isMail163Provider: () => true,
    isLuckmailProvider: () => false,
    isSignupEmailVerificationPageUrl: () => false,
    isSignupPasswordPageUrl: () => true,
    reuseOrCreateTab: async () => 1,
    sendToContentScriptResilient: async () => ({}),
    setEmailState: async (email) => {
      calls.setEmail.push(email);
    },
    SIGNUP_ENTRY_URL: 'https://chatgpt.com/',
    SIGNUP_PAGE_INJECT_FILES: [],
    waitForTabUrlMatch: async () => null,
  });

  const email = await helpers.resolveSignupEmailForFlow({
    mailProvider: '163',
    currentMail163AccountId: 'acc-3',
    autoRunLockedMail163AccountId: 'acc-5',
    email: '',
  });

  assert.equal(email, 'pool-run@163.com');
  assert.deepStrictEqual(calls.ensureMail163, [
    {
      allowAllocate: true,
      preferredAccountId: 'acc-3',
      lockedAccountId: 'acc-5',
      markRunning: true,
    },
  ]);
  assert.deepStrictEqual(calls.setEmail, ['pool-run@163.com']);
});
