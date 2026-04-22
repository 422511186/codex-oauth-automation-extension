(function mail163UtilsModule(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
    return;
  }

  root.Mail163Utils = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createMail163Utils() {
  function normalizeTimestamp(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
  }

  function normalizeRetryCount(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : 0;
  }

  function normalizeStatus(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (['idle', 'running', 'success', 'failed', 'stopped'].includes(normalized)) {
      return normalized;
    }
    return 'idle';
  }

  function normalizeMail163Account(account = {}) {
    const status = normalizeStatus(account.status);
    const success = account.success !== undefined
      ? Boolean(account.success)
      : status === 'success';

    return {
      id: String(account.id || crypto.randomUUID()),
      email: String(account.email || '').trim().toLowerCase(),
      authCode: String(account.authCode ?? account.password ?? '').trim(),
      status: success ? 'success' : status,
      success,
      used: account.used !== undefined ? Boolean(account.used) : success,
      disabled: Boolean(account.disabled),
      lastUsedAt: normalizeTimestamp(account.lastUsedAt),
      lastResultAt: normalizeTimestamp(account.lastResultAt),
      retryCount: normalizeRetryCount(account.retryCount),
      lastError: String(account.lastError || '').trim(),
    };
  }

  function normalizeMail163Accounts(accounts) {
    if (!Array.isArray(accounts)) return [];

    const deduped = new Map();
    for (const account of accounts) {
      const normalized = normalizeMail163Account(account);
      if (!normalized.email) continue;
      deduped.set(normalized.id, normalized);
    }
    return [...deduped.values()];
  }

  function findMail163Account(accounts, accountId) {
    return normalizeMail163Accounts(accounts).find((account) => account.id === accountId) || null;
  }

  function isMail163AccountRunnable(account) {
    return Boolean(account)
      && Boolean(account.email)
      && Boolean(account.authCode)
      && account.disabled !== true
      && !['failed', 'stopped'].includes(normalizeStatus(account.status))
      && account.success !== true;
  }

  function pickMail163AccountForRun(accounts, options = {}) {
    const excludeIds = new Set((options.excludeIds || []).filter(Boolean).map((item) => String(item)));
    const candidates = normalizeMail163Accounts(accounts).filter((account) => (
      isMail163AccountRunnable(account) && !excludeIds.has(account.id)
    ));
    if (!candidates.length) {
      return null;
    }

    return candidates.slice().sort((left, right) => {
      const leftResultAt = normalizeTimestamp(left.lastResultAt);
      const rightResultAt = normalizeTimestamp(right.lastResultAt);
      if (leftResultAt !== rightResultAt) {
        return leftResultAt - rightResultAt;
      }

      const leftUsedAt = normalizeTimestamp(left.lastUsedAt);
      const rightUsedAt = normalizeTimestamp(right.lastUsedAt);
      if (leftUsedAt !== rightUsedAt) {
        return leftUsedAt - rightUsedAt;
      }

      const leftRetryCount = normalizeRetryCount(left.retryCount);
      const rightRetryCount = normalizeRetryCount(right.retryCount);
      if (leftRetryCount !== rightRetryCount) {
        return leftRetryCount - rightRetryCount;
      }

      return String(left.email || '').localeCompare(String(right.email || ''));
    })[0] || null;
  }

  function parseMail163ImportText(rawText) {
    const lines = String(rawText || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const parsed = [];
    for (const line of lines) {
      const parts = line.split(/\s+/).map((part) => part.trim()).filter(Boolean);
      if (parts.length < 2) continue;
      const [email, authCode] = parts;
      if (!email || !authCode) continue;
      parsed.push({ email, authCode });
    }
    return parsed;
  }

  return {
    findMail163Account,
    isMail163AccountRunnable,
    normalizeMail163Account,
    normalizeMail163Accounts,
    normalizeStatus,
    normalizeTimestamp,
    parseMail163ImportText,
    pickMail163AccountForRun,
  };
});
