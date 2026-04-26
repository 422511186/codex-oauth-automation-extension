(function attachSidepanelMail163Manager(globalScope) {
  const MAIL163_CATEGORY_VALUES = ['idle', 'running', 'success', 'failed', 'stopped'];
  const MAIL163_FILTER_VALUES = new Set(['all', ...MAIL163_CATEGORY_VALUES]);
  const MAIL163_CATEGORY_VALUE_SET = new Set(MAIL163_CATEGORY_VALUES);
  const MAIL163_FILTER_LABELS = {
    all: '全部',
    idle: '未执行',
    running: '执行中',
    success: '成功',
    failed: '失败',
    stopped: '已停止',
  };
  const MAIL163_BACKUP_SCHEMA_VERSION = 1;
  const MAIL163_BACKUP_TYPE = 'mail163-account-pool';
  const DEFAULT_MAIL163_BULK_CATEGORY = 'idle';

  function createMail163Manager(context = {}) {
    const {
      state,
      dom,
      helpers,
      runtime,
      constants = {},
      mail163Utils = {},
    } = context;

    const expandedStorageKey = constants.expandedStorageKey || 'multipage-mail163-list-expanded';
    const displayTimeZone = constants.displayTimeZone || 'Asia/Shanghai';
    const copyIcon = constants.copyIcon || '';
    const createAccountPoolFormController = globalScope.SidepanelAccountPoolUi?.createAccountPoolFormController;

    let actionInFlight = false;
    let listExpanded = false;
    let activeFilter = 'all';
    let searchTerm = '';

    function getMail163Accounts(currentState = state.getLatestState()) {
      return helpers.getMail163Accounts(currentState);
    }

    function getCurrentMail163AccountId(currentState = state.getLatestState()) {
      return String(currentState?.currentMail163AccountId || '');
    }

    function normalizeFilter(value) {
      const normalized = String(value || '').trim().toLowerCase();
      return MAIL163_FILTER_VALUES.has(normalized) ? normalized : 'all';
    }

    function normalizeCategory(value, fallback = DEFAULT_MAIL163_BULK_CATEGORY) {
      const normalized = String(value || '').trim().toLowerCase();
      if (MAIL163_CATEGORY_VALUE_SET.has(normalized)) {
        return normalized;
      }
      return MAIL163_CATEGORY_VALUE_SET.has(String(fallback || '').trim().toLowerCase())
        ? String(fallback || '').trim().toLowerCase()
        : DEFAULT_MAIL163_BULK_CATEGORY;
    }

    function getAccountStatus(account) {
      return normalizeCategory(account?.status, 'idle');
    }

    function getCategoryLabel(value) {
      return MAIL163_FILTER_LABELS[normalizeCategory(value)] || MAIL163_FILTER_LABELS.idle;
    }

    function getSelectedBulkCategory() {
      return normalizeCategory(dom.selectMail163BulkCategory?.value, DEFAULT_MAIL163_BULK_CATEGORY);
    }

    function getBulkCategoryActionText(count) {
      const normalizedCount = Number.isFinite(Number(count)) ? Math.max(0, Number(count)) : 0;
      return normalizedCount > 0 ? `移动当前筛选（${normalizedCount}）` : '移动当前筛选';
    }

    function buildCategoryOptionsMarkup(selectedCategory) {
      const normalizedSelectedCategory = normalizeCategory(selectedCategory, DEFAULT_MAIL163_BULK_CATEGORY);
      return MAIL163_CATEGORY_VALUES.map((category) => `
        <option value="${helpers.escapeHtml(category)}"${category === normalizedSelectedCategory ? ' selected' : ''}>${helpers.escapeHtml(getCategoryLabel(category))}</option>
      `).join('');
    }

    function normalizeMail163SearchText(value) {
      return String(value || '').trim().toLowerCase();
    }

    function getAccountLatestActivityAt(account) {
      const lastResultAt = Number(account?.lastResultAt) || 0;
      const lastUsedAt = Number(account?.lastUsedAt) || 0;
      return Math.max(lastResultAt, lastUsedAt, 0);
    }

    function sortMail163Accounts(accounts = []) {
      return (Array.isArray(accounts) ? accounts.slice() : []).sort((left, right) => {
        const rightActivityAt = getAccountLatestActivityAt(right);
        const leftActivityAt = getAccountLatestActivityAt(left);
        if (rightActivityAt !== leftActivityAt) {
          return rightActivityAt - leftActivityAt;
        }

        const rightResultAt = Number(right?.lastResultAt) || 0;
        const leftResultAt = Number(left?.lastResultAt) || 0;
        if (rightResultAt !== leftResultAt) {
          return rightResultAt - leftResultAt;
        }

        const rightRetryCount = Number(right?.retryCount) || 0;
        const leftRetryCount = Number(left?.retryCount) || 0;
        if (rightRetryCount !== leftRetryCount) {
          return rightRetryCount - leftRetryCount;
        }

        return String(left?.email || '').localeCompare(String(right?.email || ''));
      });
    }

    function getFilteredMail163Accounts(currentState = state.getLatestState()) {
      const normalizedSearchTerm = normalizeMail163SearchText(searchTerm);
      const accounts = sortMail163Accounts(getMail163Accounts(currentState));
      return accounts.filter((account) => {
        const matchesFilter = activeFilter === 'all' || getAccountStatus(account) === activeFilter;
        if (!matchesFilter) {
          return false;
        }
        if (!normalizedSearchTerm) {
          return true;
        }

        const haystack = [
          account.email,
          account.lastError,
          getStatusLabel(account),
          account.success ? '已成功 success' : '未成功 pending',
        ].join(' ').toLowerCase();
        return haystack.includes(normalizedSearchTerm);
      });
    }

    function getMail163FilterCounts(currentState = state.getLatestState()) {
      const counts = {
        all: 0,
        idle: 0,
        running: 0,
        success: 0,
        failed: 0,
        stopped: 0,
      };

      const accounts = getMail163Accounts(currentState);
      counts.all = accounts.length;
      for (const account of accounts) {
        counts[getAccountStatus(account)] += 1;
      }
      return counts;
    }

    function getBulkActionText(count) {
      const normalizedCount = Number.isFinite(Number(count)) ? Math.max(0, Number(count)) : 0;
      return normalizedCount > 0 ? `全部删除（${normalizedCount}）` : '全部删除';
    }

    function getListToggleText(expanded, totalCount, visibleCount = totalCount) {
      const normalizedTotal = Number.isFinite(Number(totalCount)) ? Math.max(0, Number(totalCount)) : 0;
      const normalizedVisible = Number.isFinite(Number(visibleCount)) ? Math.max(0, Number(visibleCount)) : 0;
      const prefix = expanded ? '收起列表' : '展开列表';
      if (normalizedTotal <= 0) {
        return prefix;
      }
      if (normalizedVisible !== normalizedTotal) {
        return `${prefix}（${normalizedVisible}/${normalizedTotal}）`;
      }
      return `${prefix}（${normalizedVisible}）`;
    }

    function getExportActionText(count) {
      const normalizedCount = Number.isFinite(Number(count)) ? Math.max(0, Number(count)) : 0;
      return normalizedCount > 0 ? `导出备份（${normalizedCount}）` : '导出备份';
    }

    function getBulkTestActionText(count) {
      const normalizedCount = Number.isFinite(Number(count)) ? Math.max(0, Number(count)) : 0;
      return normalizedCount > 0 ? `批量测试当前页签（${normalizedCount}）` : '批量测试当前页签';
    }

    function updateMail163FilterButtons(currentState = state.getLatestState()) {
      const filterButtons = Array.isArray(dom.mail163FilterButtons) ? dom.mail163FilterButtons : [];
      if (!filterButtons.length) {
        return;
      }

      const counts = getMail163FilterCounts(currentState);
      for (const button of filterButtons) {
        const filterValue = normalizeFilter(button?.dataset?.mail163Filter);
        const labelBase = String(
          button?.dataset?.filterLabelBase
          || button?.textContent
          || MAIL163_FILTER_LABELS[filterValue]
          || ''
        ).trim();
        if (button?.dataset) {
          button.dataset.filterLabelBase = labelBase;
        }
        const count = counts[filterValue] || 0;
        button.textContent = count > 0 ? `${labelBase}（${count}）` : labelBase;
        button.classList.toggle('is-active', filterValue === activeFilter);
        button.setAttribute?.('aria-pressed', String(filterValue === activeFilter));
        button.disabled = counts.all === 0 && filterValue !== 'all';
      }
    }

    function updateMail163ListViewport(currentState = state.getLatestState()) {
      const totalCount = getMail163Accounts(currentState).length;
      const visibleCount = getFilteredMail163Accounts(currentState).length;

      if (dom.btnDeleteAllMail163Accounts) {
        dom.btnDeleteAllMail163Accounts.textContent = getBulkActionText(totalCount);
        dom.btnDeleteAllMail163Accounts.disabled = totalCount === 0;
      }
      if (dom.btnToggleMail163List) {
        dom.btnToggleMail163List.textContent = getListToggleText(listExpanded, totalCount, visibleCount);
        dom.btnToggleMail163List.setAttribute('aria-expanded', String(listExpanded));
        dom.btnToggleMail163List.disabled = totalCount === 0;
      }
      if (dom.btnExportMail163Accounts) {
        dom.btnExportMail163Accounts.textContent = getExportActionText(visibleCount);
        dom.btnExportMail163Accounts.disabled = visibleCount === 0;
      }
      if (dom.btnBulkTestMail163Accounts) {
        dom.btnBulkTestMail163Accounts.textContent = getBulkTestActionText(visibleCount);
        dom.btnBulkTestMail163Accounts.disabled = visibleCount === 0 || actionInFlight;
      }
      if (dom.selectMail163BulkCategory) {
        dom.selectMail163BulkCategory.value = getSelectedBulkCategory();
        dom.selectMail163BulkCategory.disabled = visibleCount === 0 || actionInFlight;
      }
      if (dom.btnApplyMail163BulkCategory) {
        dom.btnApplyMail163BulkCategory.textContent = getBulkCategoryActionText(visibleCount);
        dom.btnApplyMail163BulkCategory.disabled = visibleCount === 0 || actionInFlight;
      }
      if (dom.mail163ListShell) {
        dom.mail163ListShell.classList.toggle('is-expanded', listExpanded);
        dom.mail163ListShell.classList.toggle('is-collapsed', !listExpanded);
      }

      updateMail163FilterButtons(currentState);
    }

    function setMail163ListExpanded(expanded, options = {}) {
      const { persist = true } = options;
      listExpanded = Boolean(expanded);
      updateMail163ListViewport(state.getLatestState());
      if (persist) {
        localStorage.setItem(expandedStorageKey, listExpanded ? '1' : '0');
      }
    }

    function initMail163ListExpandedState() {
      const saved = localStorage.getItem(expandedStorageKey);
      setMail163ListExpanded(saved === '1', { persist: false });
    }

    function upsertMail163AccountListLocally(accounts, nextAccount) {
      const list = Array.isArray(accounts) ? accounts.slice() : [];
      if (!nextAccount?.id) {
        return list;
      }

      const existingIndex = list.findIndex((account) => account?.id === nextAccount.id);
      if (existingIndex === -1) {
        list.push(nextAccount);
        return list;
      }

      list[existingIndex] = nextAccount;
      return list;
    }

    function refreshMail163SelectionUI() {
      renderMail163Accounts();
      if (dom.selectMailProvider?.value === '163' && dom.inputEmail) {
        const latestState = state.getLatestState();
        const currentAccount = getMail163Accounts(latestState)
          .find((account) => account.id === getCurrentMail163AccountId(latestState)) || null;
        dom.inputEmail.value = String(currentAccount?.email || latestState?.email || '');
      }
    }

    function applyMail163AccountMutation(account, options = {}) {
      if (!account?.id) {
        return;
      }

      const { preserveCurrentSelection = false, syncEmailWhenSelected = false } = options;
      const latestState = state.getLatestState();
      const nextState = {
        mail163Accounts: upsertMail163AccountListLocally(getMail163Accounts(latestState), account),
      };

      const isCurrentAccount = latestState?.currentMail163AccountId === account.id;
      if (!preserveCurrentSelection && isCurrentAccount && account.success === true) {
        nextState.currentMail163AccountId = account.id;
      }

      if (syncEmailWhenSelected && isCurrentAccount && dom.selectMailProvider?.value === '163') {
        nextState.email = account.email || '';
      }

      state.syncLatestState(nextState);
      refreshMail163SelectionUI();
    }

    function formatDateTime(timestamp) {
      const value = Number(timestamp);
      if (!Number.isFinite(value) || value <= 0) {
        return '未记录';
      }
      return new Date(value).toLocaleString('zh-CN', {
        hour12: false,
        timeZone: displayTimeZone,
      });
    }

    function getStatusLabel(account) {
      return getCategoryLabel(getAccountStatus(account));
    }

    function getStatusClass(account) {
      const status = getAccountStatus(account);
      if (status === 'idle') {
        return 'status-pending';
      }
      if (status === 'success') {
        return 'status-authorized';
      }
      if (status === 'failed') {
        return 'status-error';
      }
      if (status === 'stopped') {
        return 'status-used';
      }
      return `status-${status}`;
    }

    function getQuickStatusAction(account) {
      const status = getAccountStatus(account);
      if (status === 'failed' || status === 'idle') {
        return {
          action: 'mark-success',
          buttonClass: 'btn btn-outline btn-sm',
          label: '标记成功',
        };
      }
      if (status === 'success') {
        return {
          action: 'mark-failed',
          buttonClass: 'btn btn-outline btn-sm',
          label: '标记失败',
        };
      }
      return null;
    }

    function clearMail163Form() {
      if (dom.inputMail163Email) dom.inputMail163Email.value = '';
      if (dom.inputMail163AuthCode) dom.inputMail163AuthCode.value = '';
    }

    const formController = typeof createAccountPoolFormController === 'function'
      ? createAccountPoolFormController({
        formShell: dom.mail163FormShell,
        toggleButton: dom.btnToggleMail163Form,
        hiddenLabel: '添加账号',
        visibleLabel: '取消添加',
        onClear: clearMail163Form,
        onFocus: () => {
          dom.inputMail163Email?.focus?.();
        },
      })
      : {
        isVisible: () => false,
        setVisible() {},
        sync() {},
      };

    function formatExportTimestamp(date = new Date()) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hour = String(date.getHours()).padStart(2, '0');
      const minute = String(date.getMinutes()).padStart(2, '0');
      const second = String(date.getSeconds()).padStart(2, '0');
      return `${year}${month}${day}-${hour}${minute}${second}`;
    }

    function getExportableMail163Accounts(currentState = state.getLatestState()) {
      return getFilteredMail163Accounts(currentState).filter((account) => account?.email && account?.authCode);
    }

    function normalizeImportTimestamp(value) {
      const numeric = Number(value);
      return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
    }

    function normalizeImportRetryCount(value) {
      const numeric = Number(value);
      return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : 0;
    }

    function buildMail163BackupExportAccount(account = {}) {
      const status = getAccountStatus(account);
      const success = account.success !== undefined ? Boolean(account.success) : status === 'success';

      return {
        id: String(account.id || '').trim(),
        email: String(account.email || '').trim().toLowerCase(),
        authCode: String(account.authCode ?? account.password ?? '').trim(),
        status: success ? 'success' : status,
        success,
        used: account.used !== undefined ? Boolean(account.used) : success,
        disabled: Boolean(account.disabled),
        lastUsedAt: normalizeImportTimestamp(account.lastUsedAt),
        lastResultAt: normalizeImportTimestamp(account.lastResultAt),
        retryCount: normalizeImportRetryCount(account.retryCount),
        lastError: String(account.lastError || '').trim(),
      };
    }

    function buildMail163BackupExportBundle(currentState = state.getLatestState()) {
      const exportableAccounts = getExportableMail163Accounts(currentState)
        .map((account) => buildMail163BackupExportAccount(account));
      return {
        schemaVersion: MAIL163_BACKUP_SCHEMA_VERSION,
        type: MAIL163_BACKUP_TYPE,
        exportedAt: new Date().toISOString(),
        filter: activeFilter,
        count: exportableAccounts.length,
        accounts: exportableAccounts,
      };
    }

    function normalizeImportedMail163Account(account = {}) {
      const status = getAccountStatus(account);
      const success = account.success !== undefined ? Boolean(account.success) : status === 'success';

      return {
        ...(account?.id ? { id: String(account.id).trim() } : {}),
        email: String(account.email || '').trim().toLowerCase(),
        authCode: String(account.authCode ?? account.password ?? '').trim(),
        status: success ? 'success' : status,
        success,
        used: account.used !== undefined ? Boolean(account.used) : success,
        disabled: Boolean(account.disabled),
        lastUsedAt: normalizeImportTimestamp(account.lastUsedAt),
        lastResultAt: normalizeImportTimestamp(account.lastResultAt),
        retryCount: normalizeImportRetryCount(account.retryCount),
        lastError: String(account.lastError || '').trim(),
      };
    }

    function parseMail163ImportJson(rawText = '') {
      try {
        const parsed = JSON.parse(String(rawText || ''));
        const accounts = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed?.accounts)
            ? parsed.accounts
            : Array.isArray(parsed?.mail163Accounts)
              ? parsed.mail163Accounts
              : Array.isArray(parsed?.settings?.mail163Accounts)
                ? parsed.settings.mail163Accounts
                : null;

        if (!accounts) {
          return { source: 'json', accounts: [] };
        }

        return {
          source: 'json',
          accounts: accounts
            .map((account) => normalizeImportedMail163Account(account))
            .filter((account) => account.email && account.authCode),
        };
      } catch {
        return null;
      }
    }

    function parseMail163ImportContent(rawText = '') {
      const jsonResult = parseMail163ImportJson(rawText);
      if (jsonResult) {
        return jsonResult;
      }

      if (typeof mail163Utils.parseMail163ImportText !== 'function') {
        return { source: 'txt', accounts: [] };
      }

      return {
        source: 'txt',
        accounts: mail163Utils.parseMail163ImportText(rawText),
      };
    }

    function renderMail163Accounts() {
      if (!dom.mail163AccountsList) return;

      const latestState = state.getLatestState();
      const allAccounts = getMail163Accounts(latestState);
      const accounts = getFilteredMail163Accounts(latestState);
      const currentId = getCurrentMail163AccountId(latestState);

      updateMail163ListViewport(latestState);

      if (!allAccounts.length) {
        dom.mail163AccountsList.innerHTML = '<div class="hotmail-empty">还没有 163 号源，先添加一条再导入流程。</div>';
        return;
      }

      if (!accounts.length) {
        dom.mail163AccountsList.innerHTML = '<div class="hotmail-empty">当前筛选下没有 163 号源。</div>';
        return;
      }

      dom.mail163AccountsList.innerHTML = accounts.map((account) => `
        ${(() => {
          const quickStatusAction = getQuickStatusAction(account);
          const quickStatusButton = quickStatusAction
            ? `<button class="${helpers.escapeHtml(quickStatusAction.buttonClass)}" type="button" data-account-action="${helpers.escapeHtml(quickStatusAction.action)}" data-account-id="${helpers.escapeHtml(account.id)}">${helpers.escapeHtml(quickStatusAction.label)}</button>`
            : '';
          const categoryEditor = `
            <div class="mail163-account-category-editor">
              <select class="data-select mail163-account-category-select" data-account-category-select data-account-id="${helpers.escapeHtml(account.id)}" aria-label="修改 ${helpers.escapeHtml(account.email || '163 号源')} 的分类">
                ${buildCategoryOptionsMarkup(getAccountStatus(account))}
              </select>
              <button class="btn btn-outline btn-sm" type="button" data-account-action="set-category" data-account-id="${helpers.escapeHtml(account.id)}">改分类</button>
            </div>
          `;
          return `
        <div class="hotmail-account-item${account.id === currentId ? ' is-current' : ''}">
          <div class="hotmail-account-top">
            <div class="hotmail-account-title-row">
              <div class="hotmail-account-email">${helpers.escapeHtml(account.email || '(未命名账号)')}</div>
              <button
                class="hotmail-copy-btn"
                type="button"
                data-account-action="copy-email"
                data-account-id="${helpers.escapeHtml(account.id)}"
                title="复制邮箱"
                aria-label="复制邮箱 ${helpers.escapeHtml(account.email || '')}"
              >${copyIcon}</button>
            </div>
            <span class="hotmail-status-chip ${helpers.escapeHtml(getStatusClass(account))}">${helpers.escapeHtml(getStatusLabel(account))}</span>
          </div>
          <div class="hotmail-account-meta">
            <span>授权码：${account.authCode ? '已保存' : '未保存'}</span>
            <span>成功状态：${account.success ? '已成功' : '未成功'}</span>
            <span>重试次数：${helpers.escapeHtml(String(Number(account.retryCount) || 0))}</span>
            <span>上次结果：${helpers.escapeHtml(formatDateTime(account.lastResultAt))}</span>
            <span>上次成功：${helpers.escapeHtml(formatDateTime(account.lastUsedAt))}</span>
          </div>
          ${account.lastError ? `<div class="hotmail-account-error">${helpers.escapeHtml(account.lastError)}</div>` : ''}
          <div class="hotmail-account-actions">
            <button class="btn btn-outline btn-sm" type="button" data-account-action="select" data-account-id="${helpers.escapeHtml(account.id)}">使用此账号</button>
            <button class="btn btn-outline btn-sm" type="button" data-account-action="test" data-account-id="${helpers.escapeHtml(account.id)}">测试</button>
            ${quickStatusButton}
            ${categoryEditor}
            <button class="btn btn-primary btn-sm" type="button" data-account-action="retry" data-account-id="${helpers.escapeHtml(account.id)}">重试</button>
            <button class="btn btn-ghost btn-sm" type="button" data-account-action="delete" data-account-id="${helpers.escapeHtml(account.id)}">删除</button>
          </div>
        </div>
      `;
        })()}
      `).join('');
    }

    async function handleAddMail163Account() {
      if (actionInFlight) return;

      const email = String(dom.inputMail163Email?.value || '').trim();
      const authCode = String(dom.inputMail163AuthCode?.value || '').trim();
      if (!email) {
        helpers.showToast('请先填写 163 邮箱。', 'warn');
        return;
      }
      if (!authCode) {
        helpers.showToast('请先填写 163 授权码。', 'warn');
        return;
      }

      actionInFlight = true;
      if (dom.btnAddMail163Account) {
        dom.btnAddMail163Account.disabled = true;
      }

      try {
        const response = await runtime.sendMessage({
          type: 'UPSERT_MAIL163_ACCOUNT',
          source: 'sidepanel',
          payload: { email, authCode },
        });
        if (response?.error) throw new Error(response.error);

        helpers.showToast(`已保存 163 号源 ${email}`, 'success', 1800);
        formController.setVisible(false, { clearForm: true });
      } catch (err) {
        helpers.showToast(`保存 163 号源失败：${err.message}`, 'error');
      } finally {
        actionInFlight = false;
        if (dom.btnAddMail163Account) {
          dom.btnAddMail163Account.disabled = false;
        }
      }
    }

    async function handleLoadMail163File() {
      if (!dom.inputMail163ImportFile) return;
      dom.inputMail163ImportFile.value = '';
      dom.inputMail163ImportFile.click();
    }

    async function handleMail163FileChange() {
      const file = dom.inputMail163ImportFile?.files?.[0];
      if (!file) return;
      const text = await file.text();
      if (dom.inputMail163Import) {
        dom.inputMail163Import.value = String(text || '').trim();
      }
      helpers.showToast(`已加载文件：${file.name}`, 'success', 1600);
    }

    async function handleImportMail163Accounts() {
      if (actionInFlight) return;

      const rawText = String(dom.inputMail163Import?.value || '').trim();
      if (!rawText) {
        helpers.showToast('请先选择 JSON/TXT 文件或粘贴导入内容。', 'warn');
        return;
      }

      const importResult = parseMail163ImportContent(rawText);
      const parsedAccounts = importResult.accounts;
      if (!parsedAccounts.length) {
        helpers.showToast(
          importResult.source === 'json'
            ? '没有解析到有效的 163 备份数据，请检查 JSON 内容。'
            : '没有解析到有效号源，请检查是否为“邮箱 空格 授权码”格式。',
          'error'
        );
        return;
      }

      actionInFlight = true;
      if (dom.btnImportMail163Accounts) {
        dom.btnImportMail163Accounts.disabled = true;
      }

      try {
        for (const account of parsedAccounts) {
          const response = await runtime.sendMessage({
            type: 'UPSERT_MAIL163_ACCOUNT',
            source: 'sidepanel',
            payload: account,
          });
          if (response?.error) {
            throw new Error(response.error);
          }
        }

        if (dom.inputMail163Import) {
          dom.inputMail163Import.value = '';
        }
        helpers.showToast(
          importResult.source === 'json'
            ? `已导入 ${parsedAccounts.length} 条 163 号源备份，状态已恢复`
            : `已导入 ${parsedAccounts.length} 条 163 号源`,
          'success',
          2200
        );
      } catch (err) {
        helpers.showToast(`导入失败：${err.message}`, 'error');
      } finally {
        actionInFlight = false;
        if (dom.btnImportMail163Accounts) {
          dom.btnImportMail163Accounts.disabled = false;
        }
      }
    }

    async function handleExportMail163Accounts() {
      if (actionInFlight) return;
      if (typeof helpers.downloadTextFile !== 'function') {
        helpers.showToast('导出能力未加载，请刷新扩展后重试。', 'error');
        return;
      }

      const latestState = state.getLatestState();
      const exportableAccounts = getExportableMail163Accounts(latestState);
      if (!exportableAccounts.length) {
        helpers.showToast('当前筛选结果没有可导出的 163 号源。', 'warn');
        return;
      }

      const backupBundle = buildMail163BackupExportBundle(latestState);
      const fileContent = JSON.stringify(backupBundle, null, 2);
      const fileName = `mail163-accounts-${activeFilter}-${formatExportTimestamp()}.json`;
      helpers.downloadTextFile(fileContent, fileName, 'application/json;charset=utf-8');

      const filteredCount = getFilteredMail163Accounts(latestState).length;
      const skippedCount = Math.max(0, filteredCount - exportableAccounts.length);
      if (skippedCount > 0) {
        helpers.showToast(`已导出 ${exportableAccounts.length} 条 163 号源备份，跳过 ${skippedCount} 条缺少邮箱或授权码的记录`, 'success', 2200);
        return;
      }
      helpers.showToast(`已导出 ${exportableAccounts.length} 条 163 号源备份`, 'success', 2200);
    }

    function buildMail163BulkTestSuccessUpdates(account) {
      const status = getAccountStatus(account);
      if (status === 'failed' || status === 'stopped') {
        return {
          status: 'idle',
          success: false,
          used: false,
          disabled: false,
          lastError: '',
          lastResultAt: 0,
        };
      }
      return null;
    }

    function buildMail163BulkTestFailureUpdates(error) {
      return {
        status: 'failed',
        success: false,
        used: false,
        lastError: String(error?.message || error || '测试失败'),
        lastResultAt: Date.now(),
      };
    }

    async function patchMail163AccountFromSidepanel(accountId, updates) {
      const response = await runtime.sendMessage({
        type: 'PATCH_MAIL163_ACCOUNT',
        source: 'sidepanel',
        payload: { accountId, updates },
      });
      if (response?.error) {
        throw new Error(response.error);
      }
      return response.account;
    }

    function buildMail163CategoryUpdates(targetCategory) {
      const normalizedCategory = normalizeCategory(targetCategory, DEFAULT_MAIL163_BULK_CATEGORY);
      const now = Date.now();
      switch (normalizedCategory) {
        case 'success':
          return {
            status: 'success',
            success: true,
            used: true,
            disabled: false,
            lastError: '',
            lastResultAt: now,
            lastUsedAt: now,
          };
        case 'failed':
          return {
            status: 'failed',
            success: false,
            used: false,
            disabled: false,
            lastError: '手动移动到失败分类',
            lastResultAt: now,
          };
        case 'stopped':
          return {
            status: 'stopped',
            success: false,
            used: false,
            disabled: false,
            lastError: '手动移动到已停止分类',
            lastResultAt: now,
          };
        case 'running':
          return {
            status: 'running',
            success: false,
            used: false,
            disabled: false,
            lastError: '',
            lastResultAt: 0,
          };
        default:
          return {
            status: 'idle',
            success: false,
            used: false,
            disabled: false,
            lastError: '',
            lastResultAt: 0,
          };
      }
    }

    async function updateMail163AccountCategory(account, targetCategory) {
      if (!account?.id) {
        throw new Error('未找到需要修改分类的 163 号源。');
      }

      const normalizedTargetCategory = normalizeCategory(targetCategory, getAccountStatus(account));
      if (getAccountStatus(account) === normalizedTargetCategory) {
        return {
          changed: false,
          account,
          targetCategory: normalizedTargetCategory,
        };
      }

      const nextAccount = await patchMail163AccountFromSidepanel(
        account.id,
        buildMail163CategoryUpdates(normalizedTargetCategory)
      );
      applyMail163AccountMutation(nextAccount, {
        preserveCurrentSelection: true,
        syncEmailWhenSelected: true,
      });
      return {
        changed: true,
        account: nextAccount,
        targetCategory: normalizedTargetCategory,
      };
    }

    async function handleBulkTestMail163Accounts() {
      if (actionInFlight) return;

      const accounts = getFilteredMail163Accounts();
      if (!accounts.length) {
        helpers.showToast('当前页签没有可测试的 163 号源。', 'warn');
        return;
      }

      const originalButtonText = String(dom.btnBulkTestMail163Accounts?.textContent || '');
      const summary = {
        total: accounts.length,
        passed: 0,
        failed: 0,
        resetToIdle: 0,
      };

      actionInFlight = true;
      if (dom.btnBulkTestMail163Accounts) {
        dom.btnBulkTestMail163Accounts.disabled = true;
        dom.btnBulkTestMail163Accounts.textContent = `批量测试中（0/${accounts.length}）`;
      }

      try {
        for (let index = 0; index < accounts.length; index += 1) {
          const account = accounts[index];
          if (dom.btnBulkTestMail163Accounts) {
            dom.btnBulkTestMail163Accounts.textContent = `批量测试中（${index + 1}/${accounts.length}）`;
          }

          try {
            const response = await runtime.sendMessage({
              type: 'TEST_MAIL163_ACCOUNT',
              source: 'sidepanel',
              payload: { accountId: account.id },
            });
            if (response?.error) {
              throw new Error(response.error);
            }

            const successUpdates = buildMail163BulkTestSuccessUpdates(account);
            const nextAccount = successUpdates
              ? await patchMail163AccountFromSidepanel(account.id, successUpdates)
              : response.account;

            if (successUpdates) {
              summary.resetToIdle += 1;
            }
            summary.passed += 1;
            applyMail163AccountMutation(nextAccount, {
              preserveCurrentSelection: true,
              syncEmailWhenSelected: true,
            });
          } catch (err) {
            const nextAccount = await patchMail163AccountFromSidepanel(
              account.id,
              buildMail163BulkTestFailureUpdates(err)
            );
            summary.failed += 1;
            applyMail163AccountMutation(nextAccount, {
              preserveCurrentSelection: true,
              syncEmailWhenSelected: true,
            });
          }

          if (dom.btnBulkTestMail163Accounts) {
            dom.btnBulkTestMail163Accounts.textContent = `批量测试中（${index + 1}/${accounts.length}）`;
          }
        }

        const resetText = summary.resetToIdle > 0 ? `，${summary.resetToIdle} 条已回到未执行` : '';
        helpers.showToast(
          `批量测试完成：共 ${summary.total} 条，通过 ${summary.passed} 条，失败 ${summary.failed} 条${resetText}`,
          summary.failed > 0 ? 'warn' : 'success',
          3200
        );
      } finally {
        actionInFlight = false;
        if (dom.btnBulkTestMail163Accounts) {
          dom.btnBulkTestMail163Accounts.textContent = originalButtonText || getBulkTestActionText(getFilteredMail163Accounts().length);
        }
        renderMail163Accounts();
      }
    }

    async function handleBulkMoveMail163Accounts() {
      if (actionInFlight) return;

      const accounts = getFilteredMail163Accounts();
      if (!accounts.length) {
        helpers.showToast('当前筛选结果没有可移动分类的 163 号源。', 'warn');
        return;
      }

      const targetCategory = getSelectedBulkCategory();
      const originalButtonText = String(dom.btnApplyMail163BulkCategory?.textContent || '');
      const summary = {
        total: accounts.length,
        moved: 0,
        skipped: 0,
        failed: 0,
      };

      actionInFlight = true;
      updateMail163ListViewport(state.getLatestState());
      if (dom.btnApplyMail163BulkCategory) {
        dom.btnApplyMail163BulkCategory.textContent = `批量移动中（0/${accounts.length}）`;
      }

      try {
        for (let index = 0; index < accounts.length; index += 1) {
          const account = accounts[index];
          if (dom.btnApplyMail163BulkCategory) {
            dom.btnApplyMail163BulkCategory.textContent = `批量移动中（${index + 1}/${accounts.length}）`;
          }

          try {
            const result = await updateMail163AccountCategory(account, targetCategory);
            if (result.changed) {
              summary.moved += 1;
            } else {
              summary.skipped += 1;
            }
          } catch {
            summary.failed += 1;
          }

          if (dom.btnApplyMail163BulkCategory) {
            dom.btnApplyMail163BulkCategory.textContent = `批量移动中（${index + 1}/${accounts.length}）`;
          }
        }

        const skippedText = summary.skipped > 0 ? `，跳过 ${summary.skipped} 条已在当前分类` : '';
        const failedText = summary.failed > 0 ? `，失败 ${summary.failed} 条` : '';
        helpers.showToast(
          `批量改分类完成：共 ${summary.total} 条，已移动 ${summary.moved} 条到${getCategoryLabel(targetCategory)}${skippedText}${failedText}`,
          summary.failed > 0 ? 'warn' : 'success',
          3200
        );
      } finally {
        actionInFlight = false;
        if (dom.btnApplyMail163BulkCategory) {
          dom.btnApplyMail163BulkCategory.textContent = originalButtonText || getBulkCategoryActionText(getFilteredMail163Accounts().length);
        }
        renderMail163Accounts();
      }
    }

    async function deleteAllMail163Accounts() {
      const accounts = getMail163Accounts();
      if (!accounts.length) {
        helpers.showToast('没有可删除的 163 号源。', 'warn');
        return;
      }

      const confirmed = await helpers.openConfirmModal({
        title: '全部删除 163 号源',
        message: `确认删除当前全部 ${accounts.length} 个 163 号源吗？`,
        confirmLabel: '确认全部删除',
        confirmVariant: 'btn-danger',
      });
      if (!confirmed) {
        return;
      }

      const response = await runtime.sendMessage({
        type: 'DELETE_MAIL163_ACCOUNTS',
        source: 'sidepanel',
        payload: { mode: 'all' },
      });
      if (response?.error) {
        throw new Error(response.error);
      }

      state.syncLatestState({
        currentMail163AccountId: null,
        mail163Accounts: [],
        ...(dom.selectMailProvider?.value === '163' ? { email: '' } : {}),
      });
      if (dom.selectMailProvider?.value === '163' && dom.inputEmail) {
        dom.inputEmail.value = '';
      }
      renderMail163Accounts();
      helpers.showToast(`已删除全部 ${response.deletedCount || 0} 个 163 号源`, 'success', 2200);
    }

    function getTargetCategoryFromActionButton(actionButton, fallbackCategory) {
      const selectElement = actionButton?.parentElement?.querySelector?.('[data-account-category-select]');
      return normalizeCategory(selectElement?.value, fallbackCategory);
    }

    async function handleAccountListClick(event) {
      const actionButton = event.target.closest('[data-account-action]');
      if (!actionButton || actionInFlight) {
        return;
      }

      const accountId = String(actionButton.dataset.accountId || '');
      const action = String(actionButton.dataset.accountAction || '');
      if (!accountId || !action) {
        return;
      }

      const targetAccount = getMail163Accounts().find((account) => account.id === accountId) || null;
      actionInFlight = true;
      actionButton.disabled = true;

      try {
        if (action === 'copy-email') {
          if (!targetAccount?.email) throw new Error('未找到可复制的邮箱地址。');
          await helpers.copyTextToClipboard(targetAccount.email);
          helpers.showToast(`已复制 ${targetAccount.email}`, 'success', 1800);
          return;
        }

        if (action === 'mark-success' || action === 'mark-failed') {
          const now = Date.now();
          const response = await runtime.sendMessage({
            type: 'PATCH_MAIL163_ACCOUNT',
            source: 'sidepanel',
            payload: {
              accountId,
              updates: action === 'mark-success'
                ? {
                  status: 'success',
                  success: true,
                  used: true,
                  lastError: '',
                  lastResultAt: now,
                  lastUsedAt: now,
                }
                : {
                  status: 'failed',
                  success: false,
                  used: false,
                  lastError: '手动标记为失败',
                  lastResultAt: now,
                },
            },
          });
          if (response?.error) throw new Error(response.error);

          applyMail163AccountMutation(response.account, {
            preserveCurrentSelection: true,
            syncEmailWhenSelected: true,
          });
          helpers.showToast(
            action === 'mark-success'
              ? `已将 163 号源标记为成功：${response.account.email}`
              : `已将 163 号源标记为失败：${response.account.email}`,
            'success',
            2200
          );
          return;
        }

        if (action === 'set-category') {
          const targetCategory = getTargetCategoryFromActionButton(actionButton, getAccountStatus(targetAccount));
          const result = await updateMail163AccountCategory(targetAccount, targetCategory);
          if (!result.changed) {
            helpers.showToast(`163 号源已在${getCategoryLabel(targetCategory)}分类：${targetAccount?.email || accountId}`, 'warn', 1800);
            return;
          }

          helpers.showToast(
            `已将 163 号源移动到${getCategoryLabel(targetCategory)}：${result.account.email}`,
            'success',
            2200
          );
          return;
        }

        if (action === 'select') {
          const response = await runtime.sendMessage({
            type: 'SELECT_MAIL163_ACCOUNT',
            source: 'sidepanel',
            payload: { accountId },
          });
          if (response?.error) throw new Error(response.error);

          state.syncLatestState({
            currentMail163AccountId: response.account.id,
            ...(dom.selectMailProvider?.value === '163' ? { email: response.account.email || '' } : {}),
          });
          applyMail163AccountMutation(response.account, {
            preserveCurrentSelection: true,
            syncEmailWhenSelected: true,
          });
          helpers.showToast(`已切换当前 163 号源为 ${response.account.email}`, 'success', 1800);
          return;
        }

        if (action === 'test') {
          const response = await runtime.sendMessage({
            type: 'TEST_MAIL163_ACCOUNT',
            source: 'sidepanel',
            payload: { accountId },
          });
          if (response?.error) throw new Error(response.error);

          applyMail163AccountMutation(response.account, {
            preserveCurrentSelection: true,
            syncEmailWhenSelected: true,
          });
          helpers.showToast(`163 号源 ${response.account.email} 校验通过`, 'success', 2000);
          return;
        }

        if (action === 'retry') {
          const response = await runtime.sendMessage({
            type: 'RETRY_MAIL163_ACCOUNT',
            source: 'sidepanel',
            payload: { accountId },
          });
          if (response?.error) throw new Error(response.error);

          state.syncLatestState({
            currentMail163AccountId: response.account.id,
            email: response.account.email || '',
          });
          applyMail163AccountMutation(response.account, {
            preserveCurrentSelection: true,
            syncEmailWhenSelected: true,
          });
          helpers.showToast(`已开始重试 163 号源 ${response.account.email}`, 'success', 2200);
          return;
        }

        if (action === 'delete') {
          const confirmed = await helpers.openConfirmModal({
            title: '删除 163 号源',
            message: '确认删除这个 163 号源吗？',
            confirmLabel: '确认删除',
            confirmVariant: 'btn-danger',
          });
          if (!confirmed) {
            return;
          }

          const wasCurrentSelected = getCurrentMail163AccountId() === accountId;
          const response = await runtime.sendMessage({
            type: 'DELETE_MAIL163_ACCOUNT',
            source: 'sidepanel',
            payload: { accountId },
          });
          if (response?.error) throw new Error(response.error);

          const nextAccounts = getMail163Accounts().filter((account) => account.id !== accountId);
          const nextState = { mail163Accounts: nextAccounts };
          if (wasCurrentSelected) {
            nextState.currentMail163AccountId = null;
            if (dom.selectMailProvider?.value === '163') {
              nextState.email = '';
            }
          }
          state.syncLatestState(nextState);
          if (dom.selectMailProvider?.value === '163' && wasCurrentSelected && dom.inputEmail) {
            dom.inputEmail.value = '';
          }
          renderMail163Accounts();
          helpers.showToast('163 号源已删除', 'success', 1800);
        }
      } catch (err) {
        helpers.showToast(err.message, 'error');
      } finally {
        actionInFlight = false;
        actionButton.disabled = false;
      }
    }

    function bindMail163Events() {
      dom.btnToggleMail163List?.addEventListener('click', () => {
        setMail163ListExpanded(!listExpanded);
      });

      dom.btnToggleMail163Form?.addEventListener('click', () => {
        if (formController.isVisible()) {
          formController.setVisible(false, { clearForm: true });
          return;
        }
        formController.setVisible(true, { focusField: true });
      });

      dom.btnDeleteAllMail163Accounts?.addEventListener('click', async () => {
        if (actionInFlight) return;
        actionInFlight = true;
        try {
          await deleteAllMail163Accounts();
        } catch (err) {
          helpers.showToast(err.message, 'error');
        } finally {
          actionInFlight = false;
          updateMail163ListViewport(state.getLatestState());
        }
      });

      dom.btnExportMail163Accounts?.addEventListener('click', () => {
        handleExportMail163Accounts().catch((err) => {
          helpers.showToast(`导出失败：${err.message}`, 'error');
        });
      });

      dom.btnBulkTestMail163Accounts?.addEventListener('click', async () => {
        try {
          await handleBulkTestMail163Accounts();
        } catch (err) {
          helpers.showToast(`批量测试失败：${err.message}`, 'error');
        }
      });

      dom.selectMail163BulkCategory?.addEventListener('change', () => {
        dom.selectMail163BulkCategory.value = getSelectedBulkCategory();
      });

      dom.btnApplyMail163BulkCategory?.addEventListener('click', async () => {
        try {
          await handleBulkMoveMail163Accounts();
        } catch (err) {
          helpers.showToast(`批量改分类失败：${err.message}`, 'error');
        }
      });

      const filterButtons = Array.isArray(dom.mail163FilterButtons) ? dom.mail163FilterButtons : [];
      for (const button of filterButtons) {
        button.dataset.filterLabelBase = String(button.textContent || MAIL163_FILTER_LABELS.all).trim();
        button.setAttribute('aria-pressed', String(normalizeFilter(button.dataset.mail163Filter) === activeFilter));
        button.addEventListener('click', () => {
          const nextFilter = normalizeFilter(button.dataset.mail163Filter);
          if (nextFilter === activeFilter) {
            return;
          }
          activeFilter = nextFilter;
          renderMail163Accounts();
        });
      }

      dom.btnLoadMail163File?.addEventListener('click', handleLoadMail163File);
      dom.inputMail163ImportFile?.addEventListener('change', () => {
        handleMail163FileChange().catch((err) => {
          helpers.showToast(`读取文件失败：${err.message}`, 'error');
        });
      });
      dom.inputMail163Search?.addEventListener('input', (event) => {
        searchTerm = event.target.value || '';
        renderMail163Accounts();
      });
      dom.btnAddMail163Account?.addEventListener('click', handleAddMail163Account);
      dom.btnImportMail163Accounts?.addEventListener('click', handleImportMail163Accounts);
      dom.mail163AccountsList?.addEventListener('click', handleAccountListClick);
      formController.sync();
      updateMail163ListViewport(state.getLatestState());
    }

    return {
      bindMail163Events,
      initMail163ListExpandedState,
      renderMail163Accounts,
    };
  }

  globalScope.SidepanelMail163Manager = {
    createMail163Manager,
  };
})(window);
