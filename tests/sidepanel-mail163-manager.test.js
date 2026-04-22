const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function createAccountPoolUiStub() {
  return {
    createAccountPoolFormController({
      formShell,
      toggleButton,
      hiddenLabel = '添加账号',
      visibleLabel = '取消添加',
      onClear,
      onFocus,
    } = {}) {
      let visible = false;

      function sync() {
        if (formShell) {
          formShell.hidden = !visible;
        }
        if (toggleButton) {
          toggleButton.textContent = visible ? visibleLabel : hiddenLabel;
          toggleButton.setAttribute?.('aria-expanded', String(visible));
        }
      }

      function setVisible(nextVisible, options = {}) {
        visible = Boolean(nextVisible);
        if (options.clearForm) {
          onClear?.();
        }
        sync();
        if (visible && options.focusField) {
          onFocus?.();
        }
      }

      sync();
      return {
        isVisible: () => visible,
        setVisible,
        sync,
      };
    },
  };
}

function loadMail163ManagerApi() {
  const source = fs.readFileSync('sidepanel/mail-163-manager.js', 'utf8');
  const windowObject = {
    SidepanelAccountPoolUi: createAccountPoolUiStub(),
  };
  const localStorageMock = {
    getItem() {
      return null;
    },
    setItem() {},
  };

  return new Function('window', 'localStorage', `${source}; return window.SidepanelMail163Manager;`)(
    windowObject,
    localStorageMock
  );
}

test('sidepanel loads mail163 manager before sidepanel bootstrap', () => {
  const html = fs.readFileSync('sidepanel/sidepanel.html', 'utf8');
  const helperIndex = html.indexOf('<script src="account-pool-ui.js"></script>');
  const mail163ManagerIndex = html.indexOf('<script src="mail-163-manager.js"></script>');
  const sidepanelIndex = html.indexOf('<script src="sidepanel.js"></script>');

  assert.notEqual(helperIndex, -1);
  assert.notEqual(mail163ManagerIndex, -1);
  assert.notEqual(sidepanelIndex, -1);
  assert.ok(helperIndex < mail163ManagerIndex);
  assert.ok(mail163ManagerIndex < sidepanelIndex);
});

test('mail163 manager exposes a factory and renders empty state', () => {
  const api = loadMail163ManagerApi();
  assert.equal(typeof api?.createMail163Manager, 'function');

  const mail163AccountsList = { innerHTML: '' };
  const manager = api.createMail163Manager({
    state: {
      getLatestState: () => ({ currentMail163AccountId: null, mail163Accounts: [] }),
      syncLatestState() {},
    },
    dom: {
      btnDeleteAllMail163Accounts: { textContent: '', disabled: false },
      btnToggleMail163List: { textContent: '', disabled: false, setAttribute() {} },
      mail163AccountsList,
      mail163ListShell: { classList: { toggle() {} } },
      selectMailProvider: { value: '163' },
      inputEmail: { value: '' },
    },
    helpers: {
      getMail163Accounts: () => [],
      escapeHtml: (value) => String(value || ''),
      showToast() {},
      openConfirmModal: async () => true,
      copyTextToClipboard: async () => {},
    },
    runtime: {
      sendMessage: async () => ({}),
    },
    constants: {
      copyIcon: '',
      displayTimeZone: 'Asia/Shanghai',
      expandedStorageKey: 'multipage-mail163-list-expanded',
    },
    mail163Utils: {},
  });

  assert.equal(typeof manager.renderMail163Accounts, 'function');
  assert.equal(typeof manager.bindMail163Events, 'function');
  assert.equal(typeof manager.initMail163ListExpandedState, 'function');

  manager.renderMail163Accounts();
  assert.match(mail163AccountsList.innerHTML, /还没有 163 号源/);
});

test('mail163 manager retry action syncs current selection and input email locally', async () => {
  const api = loadMail163ManagerApi();
  const handlers = {};
  const inputEmail = { value: '' };
  const stateStore = {
    currentMail163AccountId: null,
    email: '',
    mail163Accounts: [
      {
        id: 'acc-1',
        email: 'failed@163.com',
        authCode: 'auth-1',
        status: 'failed',
        success: false,
        used: false,
        disabled: false,
        retryCount: 2,
        lastError: 'old error',
        lastResultAt: 100,
        lastUsedAt: 0,
      },
    ],
  };

  const manager = api.createMail163Manager({
    state: {
      getLatestState: () => stateStore,
      syncLatestState: (updates) => {
        Object.assign(stateStore, updates);
      },
    },
    dom: {
      btnAddMail163Account: { disabled: false, addEventListener() {} },
      btnDeleteAllMail163Accounts: { textContent: '', disabled: false, addEventListener() {} },
      btnImportMail163Accounts: { disabled: false, addEventListener() {} },
      btnLoadMail163File: { addEventListener() {} },
      btnToggleMail163Form: { textContent: '', setAttribute() {}, addEventListener() {} },
      btnToggleMail163List: { textContent: '', disabled: false, setAttribute() {}, addEventListener() {} },
      inputEmail,
      inputMail163AuthCode: { value: '' },
      inputMail163Email: { value: '', focus() {} },
      inputMail163Import: { value: '' },
      inputMail163ImportFile: { addEventListener() {} },
      mail163AccountsList: {
        innerHTML: '',
        addEventListener(type, handler) {
          if (type === 'click') handlers.listClick = handler;
        },
      },
      mail163FormShell: { hidden: true },
      mail163ListShell: { classList: { toggle() {} } },
      selectMailProvider: { value: '163' },
    },
    helpers: {
      getMail163Accounts: (currentState = stateStore) => currentState.mail163Accounts,
      escapeHtml: (value) => String(value || ''),
      showToast() {},
      openConfirmModal: async () => true,
      copyTextToClipboard: async () => {},
    },
    runtime: {
      sendMessage: async (message) => {
        assert.equal(message.type, 'RETRY_MAIL163_ACCOUNT');
        return {
          ok: true,
          account: {
            id: 'acc-1',
            email: 'retry@163.com',
            authCode: 'auth-1',
            status: 'idle',
            success: false,
            used: false,
            disabled: false,
            retryCount: 2,
            lastError: '',
            lastResultAt: 0,
            lastUsedAt: 0,
          },
        };
      },
    },
    constants: {
      copyIcon: '',
      displayTimeZone: 'Asia/Shanghai',
      expandedStorageKey: 'multipage-mail163-list-expanded',
    },
    mail163Utils: {},
  });

  manager.bindMail163Events();
  await handlers.listClick({
    target: {
      closest() {
        return {
          dataset: {
            accountAction: 'retry',
            accountId: 'acc-1',
          },
          disabled: false,
        };
      },
    },
  });

  assert.equal(stateStore.currentMail163AccountId, 'acc-1');
  assert.equal(stateStore.email, 'retry@163.com');
  assert.equal(stateStore.mail163Accounts[0].email, 'retry@163.com');
  assert.equal(stateStore.mail163Accounts[0].status, 'idle');
  assert.equal(stateStore.mail163Accounts[0].lastError, '');
  assert.equal(inputEmail.value, 'retry@163.com');
});
