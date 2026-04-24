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

function createClassListStub() {
  const values = new Set();
  return {
    add(name) {
      values.add(name);
    },
    remove(name) {
      values.delete(name);
    },
    toggle(name, force) {
      if (force === undefined) {
        if (values.has(name)) {
          values.delete(name);
          return false;
        }
        values.add(name);
        return true;
      }
      if (force) {
        values.add(name);
        return true;
      }
      values.delete(name);
      return false;
    },
    contains(name) {
      return values.has(name);
    },
  };
}

function createButtonStub(textContent = '') {
  return {
    textContent,
    disabled: false,
    dataset: {},
    attributes: {},
    classList: createClassListStub(),
    listeners: {},
    addEventListener(type, handler) {
      this.listeners[type] = handler;
    },
    click() {
      this.listeners.click?.();
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  };
}

function createFilterButton(filterValue, label) {
  const button = createButtonStub(label);
  button.dataset.mail163Filter = filterValue;
  return button;
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
  assert.match(html, /id="input-mail163-search"/);
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
      btnDeleteAllMail163Accounts: createButtonStub(),
      btnExportMail163Accounts: createButtonStub(),
      btnToggleMail163List: createButtonStub(),
      inputMail163Search: { value: '', addEventListener() {} },
      mail163AccountsList,
      mail163ListShell: { classList: createClassListStub() },
      selectMailProvider: { value: '163' },
      inputEmail: { value: '' },
      mail163FilterButtons: [
        createFilterButton('all', '全部'),
        createFilterButton('idle', '未执行'),
      ],
    },
    helpers: {
      getMail163Accounts: () => [],
      escapeHtml: (value) => String(value || ''),
      showToast() {},
      openConfirmModal: async () => true,
      copyTextToClipboard: async () => {},
      downloadTextFile() {},
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
      btnAddMail163Account: createButtonStub(),
      btnDeleteAllMail163Accounts: createButtonStub(),
      btnExportMail163Accounts: createButtonStub(),
      btnImportMail163Accounts: createButtonStub(),
      btnLoadMail163File: createButtonStub(),
      btnToggleMail163Form: createButtonStub(),
      btnToggleMail163List: createButtonStub(),
      inputEmail,
      inputMail163Search: { value: '', addEventListener() {} },
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
      mail163FilterButtons: [
        createFilterButton('all', '全部'),
        createFilterButton('failed', '失败'),
      ],
      mail163FormShell: { hidden: true },
      mail163ListShell: { classList: createClassListStub() },
      selectMailProvider: { value: '163' },
    },
    helpers: {
      getMail163Accounts: (currentState = stateStore) => currentState.mail163Accounts,
      escapeHtml: (value) => String(value || ''),
      showToast() {},
      openConfirmModal: async () => true,
      copyTextToClipboard: async () => {},
      downloadTextFile() {},
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

test('mail163 manager filters current list and exports filtered backup json data', async () => {
  const api = loadMail163ManagerApi();
  const downloads = [];
  const toasts = [];
  const btnExportMail163Accounts = createButtonStub();
  const inputMail163Search = {
    value: '',
    listeners: {},
    addEventListener(type, handler) {
      this.listeners[type] = handler;
    },
  };
  const filterAllButton = createFilterButton('all', '全部');
  const filterFailedButton = createFilterButton('failed', '失败');
  const filterSuccessButton = createFilterButton('success', '成功');
  const mail163AccountsList = {
    innerHTML: '',
    addEventListener() {},
  };
  const stateStore = {
    currentMail163AccountId: 'failed-1',
    email: 'failed-1@163.com',
    mail163Accounts: [
      {
        id: 'idle-1',
        email: 'idle-1@163.com',
        authCode: 'idle-auth',
        status: 'idle',
        success: false,
        retryCount: 0,
        lastResultAt: 0,
        lastUsedAt: 0,
      },
      {
        id: 'failed-1',
        email: 'failed-1@163.com',
        authCode: 'failed-auth',
        status: 'failed',
        success: false,
        retryCount: 1,
        lastError: 'helper 登录失败',
        lastResultAt: 100,
        lastUsedAt: 0,
      },
      {
        id: 'failed-2',
        email: 'failed-2@163.com',
        authCode: '',
        status: 'failed',
        success: false,
        retryCount: 2,
        lastError: 'helper 超时',
        lastResultAt: 200,
        lastUsedAt: 0,
      },
      {
        id: 'success-1',
        email: 'success-1@163.com',
        authCode: 'success-auth',
        status: 'success',
        success: true,
        retryCount: 0,
        lastResultAt: 300,
        lastUsedAt: 300,
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
      btnAddMail163Account: createButtonStub(),
      btnDeleteAllMail163Accounts: createButtonStub(),
      btnExportMail163Accounts,
      btnImportMail163Accounts: createButtonStub(),
      btnLoadMail163File: createButtonStub(),
      btnToggleMail163Form: createButtonStub(),
      btnToggleMail163List: createButtonStub(),
      inputEmail: { value: 'failed-1@163.com' },
      inputMail163Search,
      inputMail163AuthCode: { value: '' },
      inputMail163Email: { value: '', focus() {} },
      inputMail163Import: { value: '' },
      inputMail163ImportFile: { addEventListener() {} },
      mail163AccountsList,
      mail163FilterButtons: [
        filterAllButton,
        filterFailedButton,
        filterSuccessButton,
      ],
      mail163FormShell: { hidden: true },
      mail163ListShell: { classList: createClassListStub() },
      selectMailProvider: { value: '163' },
    },
    helpers: {
      getMail163Accounts: (currentState = stateStore) => currentState.mail163Accounts,
      escapeHtml: (value) => String(value || ''),
      showToast(message, level) {
        toasts.push({ message, level });
      },
      openConfirmModal: async () => true,
      copyTextToClipboard: async () => {},
      downloadTextFile(content, fileName, mimeType) {
        downloads.push({ content, fileName, mimeType });
      },
    },
    runtime: {
      sendMessage: async () => ({ ok: true }),
    },
    constants: {
      copyIcon: '',
      displayTimeZone: 'Asia/Shanghai',
      expandedStorageKey: 'multipage-mail163-list-expanded',
    },
    mail163Utils: {},
  });

  manager.bindMail163Events();
  filterFailedButton.click();

  assert.match(mail163AccountsList.innerHTML, /failed-1@163\.com/);
  assert.match(mail163AccountsList.innerHTML, /failed-2@163\.com/);
  assert.doesNotMatch(mail163AccountsList.innerHTML, /idle-1@163\.com/);
  assert.doesNotMatch(mail163AccountsList.innerHTML, /success-1@163\.com/);
  assert.match(filterFailedButton.textContent, /失败（2）/);
  assert.equal(filterFailedButton.attributes['aria-pressed'], 'true');
  assert.match(btnExportMail163Accounts.textContent, /导出备份（2）/);

  btnExportMail163Accounts.click();

  assert.equal(downloads.length, 1);
  const exportedBundle = JSON.parse(downloads[0].content);
  assert.equal(exportedBundle.type, 'mail163-account-pool');
  assert.equal(exportedBundle.filter, 'failed');
  assert.equal(exportedBundle.count, 1);
  assert.deepStrictEqual(exportedBundle.accounts, [
    {
      id: 'failed-1',
      email: 'failed-1@163.com',
      authCode: 'failed-auth',
      status: 'failed',
      success: false,
      used: false,
      disabled: false,
      lastUsedAt: 0,
      lastResultAt: 100,
      retryCount: 1,
      lastError: 'helper 登录失败',
    },
  ]);
  assert.match(downloads[0].fileName, /^mail163-accounts-failed-\d{8}-\d{6}\.json$/);
  assert.equal(downloads[0].mimeType, 'application/json;charset=utf-8');
  assert.equal(toasts.at(-1)?.level, 'success');
  assert.match(toasts.at(-1)?.message || '', /已导出 1 条 163 号源备份，跳过 1 条/);

  inputMail163Search.value = 'failed-1';
  inputMail163Search.listeners.input({ target: inputMail163Search });
  assert.match(mail163AccountsList.innerHTML, /failed-1@163\.com/);
  assert.doesNotMatch(mail163AccountsList.innerHTML, /failed-2@163\.com/);

  inputMail163Search.value = '超时';
  inputMail163Search.listeners.input({ target: inputMail163Search });
  assert.match(mail163AccountsList.innerHTML, /failed-2@163\.com/);
  assert.doesNotMatch(mail163AccountsList.innerHTML, /failed-1@163\.com/);

  inputMail163Search.value = '';
  inputMail163Search.listeners.input({ target: inputMail163Search });
  const failed2Index = mail163AccountsList.innerHTML.indexOf('failed-2@163.com');
  const failed1Index = mail163AccountsList.innerHTML.indexOf('failed-1@163.com');
  assert.notEqual(failed2Index, -1);
  assert.notEqual(failed1Index, -1);
  assert.ok(failed2Index < failed1Index, 'failed accounts should be sorted by latest result time descending');
});

test('mail163 manager imports backup json and preserves statuses', async () => {
  const api = loadMail163ManagerApi();
  const messages = [];
  const toasts = [];
  const btnImportMail163Accounts = createButtonStub();
  const importPayload = JSON.stringify({
    type: 'mail163-account-pool',
    schemaVersion: 1,
    accounts: [
      {
        id: 'acc-success',
        email: 'success@163.com',
        authCode: 'success-auth',
        status: 'success',
        success: true,
        used: true,
        disabled: false,
        lastUsedAt: 1700000000000,
        lastResultAt: 1700000000000,
        retryCount: 1,
        lastError: '',
      },
      {
        id: 'acc-stopped',
        email: 'stopped@163.com',
        authCode: 'stopped-auth',
        status: 'stopped',
        success: false,
        used: false,
        disabled: false,
        lastUsedAt: 0,
        lastResultAt: 1700000001000,
        retryCount: 2,
        lastError: '手动停止',
      },
    ],
  }, null, 2);

  const stateStore = {
    currentMail163AccountId: null,
    email: '',
    mail163Accounts: [],
  };

  const manager = api.createMail163Manager({
    state: {
      getLatestState: () => stateStore,
      syncLatestState: (updates) => {
        Object.assign(stateStore, updates);
      },
    },
    dom: {
      btnAddMail163Account: createButtonStub(),
      btnDeleteAllMail163Accounts: createButtonStub(),
      btnExportMail163Accounts: createButtonStub(),
      btnImportMail163Accounts,
      btnLoadMail163File: createButtonStub(),
      btnToggleMail163Form: createButtonStub(),
      btnToggleMail163List: createButtonStub(),
      inputEmail: { value: '' },
      inputMail163Search: { value: '', addEventListener() {} },
      inputMail163AuthCode: { value: '' },
      inputMail163Email: { value: '', focus() {} },
      inputMail163Import: { value: importPayload },
      inputMail163ImportFile: { addEventListener() {} },
      mail163AccountsList: { innerHTML: '', addEventListener() {} },
      mail163FilterButtons: [createFilterButton('all', '全部')],
      mail163FormShell: { hidden: true },
      mail163ListShell: { classList: createClassListStub() },
      selectMailProvider: { value: '163' },
    },
    helpers: {
      getMail163Accounts: (currentState = stateStore) => currentState.mail163Accounts,
      escapeHtml: (value) => String(value || ''),
      showToast(message, level) {
        toasts.push({ message, level });
      },
      openConfirmModal: async () => true,
      copyTextToClipboard: async () => {},
      downloadTextFile() {},
    },
    runtime: {
      sendMessage: async (message) => {
        messages.push(message);
        return { ok: true, account: message.payload };
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
  await btnImportMail163Accounts.listeners.click();

  assert.equal(messages.length, 2);
  assert.deepStrictEqual(messages.map((message) => message.type), [
    'UPSERT_MAIL163_ACCOUNT',
    'UPSERT_MAIL163_ACCOUNT',
  ]);
  assert.deepStrictEqual(messages[0].payload, {
    id: 'acc-success',
    email: 'success@163.com',
    authCode: 'success-auth',
    status: 'success',
    success: true,
    used: true,
    disabled: false,
    lastUsedAt: 1700000000000,
    lastResultAt: 1700000000000,
    retryCount: 1,
    lastError: '',
  });
  assert.deepStrictEqual(messages[1].payload, {
    id: 'acc-stopped',
    email: 'stopped@163.com',
    authCode: 'stopped-auth',
    status: 'stopped',
    success: false,
    used: false,
    disabled: false,
    lastUsedAt: 0,
    lastResultAt: 1700000001000,
    retryCount: 2,
    lastError: '手动停止',
  });
  assert.equal(toasts.at(-1)?.level, 'success');
  assert.match(toasts.at(-1)?.message || '', /已导入 2 条 163 号源备份，状态已恢复/);
});

test('mail163 manager can quickly toggle idle, failed, and success statuses', async () => {
  const api = loadMail163ManagerApi();
  const handlers = {};
  const messages = [];
  const toasts = [];
  const stateStore = {
    currentMail163AccountId: 'success-1',
    email: 'success-1@163.com',
    mail163Accounts: [
      {
        id: 'idle-1',
        email: 'idle-1@163.com',
        authCode: 'idle-auth',
        status: 'idle',
        success: false,
        used: false,
        retryCount: 0,
        lastError: '',
        lastResultAt: 0,
        lastUsedAt: 0,
      },
      {
        id: 'failed-1',
        email: 'failed-1@163.com',
        authCode: 'failed-auth',
        status: 'failed',
        success: false,
        used: false,
        retryCount: 1,
        lastError: 'old error',
        lastResultAt: 100,
        lastUsedAt: 0,
      },
      {
        id: 'success-1',
        email: 'success-1@163.com',
        authCode: 'success-auth',
        status: 'success',
        success: true,
        used: true,
        retryCount: 0,
        lastError: '',
        lastResultAt: 200,
        lastUsedAt: 200,
      },
    ],
  };
  const inputEmail = { value: 'success-1@163.com' };
  const mail163AccountsList = {
    innerHTML: '',
    addEventListener(type, handler) {
      if (type === 'click') handlers.listClick = handler;
    },
  };

  const manager = api.createMail163Manager({
    state: {
      getLatestState: () => stateStore,
      syncLatestState: (updates) => {
        Object.assign(stateStore, updates);
      },
    },
    dom: {
      btnAddMail163Account: createButtonStub(),
      btnDeleteAllMail163Accounts: createButtonStub(),
      btnExportMail163Accounts: createButtonStub(),
      btnImportMail163Accounts: createButtonStub(),
      btnLoadMail163File: createButtonStub(),
      btnToggleMail163Form: createButtonStub(),
      btnToggleMail163List: createButtonStub(),
      inputEmail,
      inputMail163Search: { value: '', addEventListener() {} },
      inputMail163AuthCode: { value: '' },
      inputMail163Email: { value: '', focus() {} },
      inputMail163Import: { value: '' },
      inputMail163ImportFile: { addEventListener() {} },
      mail163AccountsList,
      mail163FilterButtons: [
        createFilterButton('all', '全部'),
        createFilterButton('failed', '失败'),
        createFilterButton('success', '成功'),
      ],
      mail163FormShell: { hidden: true },
      mail163ListShell: { classList: createClassListStub() },
      selectMailProvider: { value: '163' },
    },
    helpers: {
      getMail163Accounts: (currentState = stateStore) => currentState.mail163Accounts,
      escapeHtml: (value) => String(value || ''),
      showToast(message, level) {
        toasts.push({ message, level });
      },
      openConfirmModal: async () => true,
      copyTextToClipboard: async () => {},
      downloadTextFile() {},
    },
    runtime: {
      sendMessage: async (message) => {
        messages.push(message);
        if (message.type !== 'PATCH_MAIL163_ACCOUNT') {
          throw new Error(`unexpected message type: ${message.type}`);
        }
        if (message.payload.accountId === 'idle-1' || message.payload.accountId === 'failed-1') {
          const sourceAccount = stateStore.mail163Accounts.find((account) => account.id === message.payload.accountId);
          return {
            ok: true,
            account: {
              ...sourceAccount,
              status: 'success',
              success: true,
              used: true,
              lastError: '',
              lastResultAt: message.payload.updates.lastResultAt,
              lastUsedAt: message.payload.updates.lastUsedAt,
            },
          };
        }
        return {
          ok: true,
          account: {
            ...stateStore.mail163Accounts[2],
            status: 'failed',
            success: false,
            used: false,
            lastError: '手动标记为失败',
            lastResultAt: message.payload.updates.lastResultAt,
            lastUsedAt: stateStore.mail163Accounts[2].lastUsedAt,
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

  manager.renderMail163Accounts();
  assert.match(mail163AccountsList.innerHTML, /idle-1@163\.com[\s\S]*data-account-action="mark-success"/);
  assert.match(mail163AccountsList.innerHTML, /data-account-action="mark-success"/);
  assert.match(mail163AccountsList.innerHTML, /data-account-action="mark-failed"/);

  manager.bindMail163Events();

  await handlers.listClick({
    target: {
      closest() {
        return {
          dataset: {
            accountAction: 'mark-success',
            accountId: 'idle-1',
          },
          disabled: false,
        };
      },
    },
  });

  assert.equal(messages[0].type, 'PATCH_MAIL163_ACCOUNT');
  assert.equal(messages[0].payload.accountId, 'idle-1');
  assert.equal(messages[0].payload.updates.status, 'success');
  assert.equal(messages[0].payload.updates.success, true);
  assert.equal(messages[0].payload.updates.used, true);
  assert.equal(stateStore.mail163Accounts[0].status, 'success');
  assert.equal(stateStore.mail163Accounts[0].success, true);
  assert.equal(stateStore.mail163Accounts[0].used, true);
  assert.equal(stateStore.mail163Accounts[0].lastError, '');

  await handlers.listClick({
    target: {
      closest() {
        return {
          dataset: {
            accountAction: 'mark-success',
            accountId: 'failed-1',
          },
          disabled: false,
        };
      },
    },
  });

  assert.equal(messages[1].type, 'PATCH_MAIL163_ACCOUNT');
  assert.equal(messages[1].payload.accountId, 'failed-1');
  assert.equal(messages[1].payload.updates.status, 'success');
  assert.equal(messages[1].payload.updates.success, true);
  assert.equal(messages[1].payload.updates.used, true);
  assert.equal(stateStore.mail163Accounts[1].status, 'success');
  assert.equal(stateStore.mail163Accounts[1].success, true);
  assert.equal(stateStore.mail163Accounts[1].used, true);
  assert.equal(stateStore.mail163Accounts[1].lastError, '');

  await handlers.listClick({
    target: {
      closest() {
        return {
          dataset: {
            accountAction: 'mark-failed',
            accountId: 'success-1',
          },
          disabled: false,
        };
      },
    },
  });

  assert.equal(messages[2].type, 'PATCH_MAIL163_ACCOUNT');
  assert.equal(messages[2].payload.accountId, 'success-1');
  assert.equal(messages[2].payload.updates.status, 'failed');
  assert.equal(messages[2].payload.updates.success, false);
  assert.equal(messages[2].payload.updates.used, false);
  assert.equal(stateStore.mail163Accounts[2].status, 'failed');
  assert.equal(stateStore.mail163Accounts[2].success, false);
  assert.equal(stateStore.mail163Accounts[2].used, false);
  assert.equal(stateStore.mail163Accounts[2].lastError, '手动标记为失败');
  assert.equal(inputEmail.value, 'success-1@163.com');
  assert.equal(toasts.at(-1)?.level, 'success');
});
