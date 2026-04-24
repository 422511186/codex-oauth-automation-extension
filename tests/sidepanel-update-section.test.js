const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const sidepanelSource = fs.readFileSync('sidepanel/sidepanel.js', 'utf8');

function extractFunction(name) {
  const markers = [`async function ${name}(`, `function ${name}(`];
  const start = markers
    .map((marker) => sidepanelSource.indexOf(marker))
    .find((index) => index >= 0);
  if (start < 0) {
    throw new Error(`missing function ${name}`);
  }

  let parenDepth = 0;
  let signatureEnded = false;
  let braceStart = -1;
  for (let i = start; i < sidepanelSource.length; i += 1) {
    const ch = sidepanelSource[i];
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

  let depth = 0;
  let end = braceStart;
  for (; end < sidepanelSource.length; end += 1) {
    const ch = sidepanelSource[end];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end += 1;
        break;
      }
    }
  }

  return sidepanelSource.slice(start, end);
}

test('sidepanel html contains collapsible update section controls', () => {
  const html = fs.readFileSync('sidepanel/sidepanel.html', 'utf8');

  assert.match(html, /id="btn-toggle-update-details"/);
  assert.match(html, /id="update-release-list"[^>]*hidden/);
});

test('setUpdateReleaseListExpanded keeps update details collapsed by default and expands on demand', () => {
  const bundle = extractFunction('setUpdateReleaseListExpanded');

  const api = new Function(`
let isUpdateReleaseListExpanded = false;
const updateReleaseList = {
  hidden: true,
};
const btnToggleUpdateDetails = {
  hidden: true,
  textContent: '',
  attributes: {},
  setAttribute(name, value) {
    this.attributes[name] = value;
  },
};
${bundle}
return {
  setUpdateReleaseListExpanded,
  getSnapshot() {
    return {
      expanded: isUpdateReleaseListExpanded,
      listHidden: updateReleaseList.hidden,
      buttonHidden: btnToggleUpdateDetails.hidden,
      buttonText: btnToggleUpdateDetails.textContent,
      ariaExpanded: btnToggleUpdateDetails.attributes['aria-expanded'],
    };
  },
};
`)();

  api.setUpdateReleaseListExpanded(false, { hasReleases: true });
  assert.deepEqual(api.getSnapshot(), {
    expanded: false,
    listHidden: true,
    buttonHidden: false,
    buttonText: '展开详情',
    ariaExpanded: 'false',
  });

  api.setUpdateReleaseListExpanded(true, { hasReleases: true });
  assert.deepEqual(api.getSnapshot(), {
    expanded: true,
    listHidden: false,
    buttonHidden: false,
    buttonText: '收起详情',
    ariaExpanded: 'true',
  });

  api.setUpdateReleaseListExpanded(true, { hasReleases: false });
  assert.deepEqual(api.getSnapshot(), {
    expanded: false,
    listHidden: true,
    buttonHidden: true,
    buttonText: '展开详情',
    ariaExpanded: 'false',
  });
});
