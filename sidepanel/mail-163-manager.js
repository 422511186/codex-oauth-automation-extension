(function attachSidepanelMail163Manager(globalScope) {
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

    function getMail163Accounts(currentState = state.getLatestState()) {
      return helpers.getMail163Accounts(currentState);
    }

    function getCurrentMail163AccountId(currentState = state.getLatestState()) {
      return String(currentState?.currentMail163AccountId || '');
    }

    function getBulkActionText(count) {
      const normalizedCount = Number.isFinite(Number(count)) ? Math.max(0, Number(count)) : 0;
      return normalizedCount > 0 ? `全部删除（${normalizedCount}）` : '全部删除';
    }

    function getListToggleText(expanded, count) {
      const normalizedCount = Number.isFinite(Number(count)) ? Math.max(0, Number(count)) : 0;
      const prefix = expanded ? '收起列表' : '展开列表';
      return normalizedCount > 0 ? `${prefix}（${normalizedCount}）` : prefix;
    }

    function updateMail163ListViewport() {
      const count = getMail163Accounts().length;
      if (dom.btnDeleteAllMail163Accounts) {
        dom.btnDeleteAllMail163Accounts.textContent = getBulkActionText(count);
        dom.btnDeleteAllMail163Accounts.disabled = count === 0;
      }
      if (dom.btnToggleMail163List) {
        dom.btnToggleMail163List.textContent = getListToggleText(listExpanded, count);
        dom.btnToggleMail163List.setAttribute('aria-expanded', String(listExpanded));
        dom.btnToggleMail163List.disabled = count === 0;
      }
      if (dom.mail163ListShell) {
        dom.mail163ListShell.classList.toggle('is-expanded', listExpanded);
        dom.mail163ListShell.classList.toggle('is-collapsed', !listExpanded);
      }
    }

    function setMail163ListExpanded(expanded, options = {}) {
      const { persist = true } = options;
      listExpanded = Boolean(expanded);
      updateMail163ListViewport();
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
        const currentAccount = getMail163Accounts(latestState).find((account) => account.id === getCurrentMail163AccountId(latestState)) || null;
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
      switch (String(account?.status || '').trim().toLowerCase()) {
        case 'running':
          return '执行中';
        case 'success':
          return '成功';
        case 'failed':
          return '失败';
        case 'stopped':
          return '已停止';
        default:
          return '未执行';
      }
    }

    function getStatusClass(account) {
      const status = String(account?.status || '').trim().toLowerCase();
      if (!status || status === 'idle') {
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

    function renderMail163Accounts() {
      if (!dom.mail163AccountsList) return;

      const latestState = state.getLatestState();
      const accounts = getMail163Accounts(latestState);
      const currentId = getCurrentMail163AccountId(latestState);

      if (!accounts.length) {
        dom.mail163AccountsList.innerHTML = '<div class="hotmail-empty">还没有 163 号源，先添加一条再导入流程。</div>';
        updateMail163ListViewport();
        return;
      }

      dom.mail163AccountsList.innerHTML = accounts.map((account) => `
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
            <button class="btn btn-primary btn-sm" type="button" data-account-action="retry" data-account-id="${helpers.escapeHtml(account.id)}">重试</button>
            <button class="btn btn-ghost btn-sm" type="button" data-account-action="delete" data-account-id="${helpers.escapeHtml(account.id)}">删除</button>
          </div>
        </div>
      `).join('');

      updateMail163ListViewport();
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
        helpers.showToast('请先选择 TXT 文件或粘贴导入内容。', 'warn');
        return;
      }
      if (typeof mail163Utils.parseMail163ImportText !== 'function') {
        helpers.showToast('163 导入解析器未加载，请刷新扩展后重试。', 'error');
        return;
      }

      const parsedAccounts = mail163Utils.parseMail163ImportText(rawText);
      if (!parsedAccounts.length) {
        helpers.showToast('没有解析到有效号源，请检查是否为“邮箱 空格 授权码”格式。', 'error');
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
        helpers.showToast(`已导入 ${parsedAccounts.length} 条 163 号源`, 'success', 2200);
      } catch (err) {
        helpers.showToast(`导入失败：${err.message}`, 'error');
      } finally {
        actionInFlight = false;
        if (dom.btnImportMail163Accounts) {
          dom.btnImportMail163Accounts.disabled = false;
        }
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
          updateMail163ListViewport();
        }
      });

      dom.btnLoadMail163File?.addEventListener('click', handleLoadMail163File);
      dom.inputMail163ImportFile?.addEventListener('change', () => {
        handleMail163FileChange().catch((err) => {
          helpers.showToast(`读取文件失败：${err.message}`, 'error');
        });
      });
      dom.btnAddMail163Account?.addEventListener('click', handleAddMail163Account);
      dom.btnImportMail163Accounts?.addEventListener('click', handleImportMail163Accounts);
      dom.mail163AccountsList?.addEventListener('click', handleAccountListClick);
      formController.sync();
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
