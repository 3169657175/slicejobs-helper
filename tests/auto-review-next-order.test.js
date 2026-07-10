const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('src/auto-review.js', 'utf8');
const cut = source.indexOf('    // 右上角提示');
assert(cut > 0, 'could not isolate next-order helpers');

const dialogs = [];
const loadingMasks = [];
const observers = [];
global.getComputedStyle = element => element._style || { display: 'block', visibility: 'visible', pointerEvents: 'auto' };
global.document = {
  body: {},
  querySelectorAll(selector) {
    if (selector.includes('el-dialog__wrapper') || selector.includes('el-message-box__wrapper')) return dialogs;
    if (selector === '.el-loading-mask') return loadingMasks;
    return [];
  }
};
global.MutationObserver = class {
  constructor(callback) { this.callback = callback; observers.push(this); }
  observe() {}
  disconnect() { this.disconnected = true; }
};

const api = Function(`${source.slice(0, cut)}\nreturn {
  getNext: autoReviewGetNextOrderButton,
  waitNext: autoReviewWaitForNextOrderButton,
  waitReady: autoReviewWaitForNextOrderReady
};`)();

function button(text = '审核下一单') {
  return {
    textContent: text,
    isConnected: true,
    disabled: false,
    dataset: {},
    _style: { display: 'block', visibility: 'visible', pointerEvents: 'auto' }
  };
}

function successDialog(buttons) {
  return {
    textContent: '审核成功 已确认订单结果！',
    _style: { display: 'block', visibility: 'visible' },
    querySelectorAll(selector) { return selector === 'button' ? buttons : []; }
  };
}

(async () => {
  assert.strictEqual(api.getNext(), null, 'button must be scoped to a visible success dialog');

  const next = button();
  const waiting = api.waitNext(1000);
  dialogs.push(successDialog([button('返回列表'), next]));
  observers.forEach(observer => { if (!observer.disconnected) observer.callback([]); });
  assert.strictEqual(await waiting, next, 'MutationObserver should resolve as soon as the success button appears');

  const stableStart = Date.now();
  const ready = await api.waitReady(next, 100, 1000);
  assert.strictEqual(ready, next);
  assert(Date.now() - stableStart >= 90, 'button should remain stable briefly before clicking');

  const mask = { _style: { display: 'block', visibility: 'visible' } };
  loadingMasks.push(mask);
  const maskedStart = Date.now();
  const maskedWait = api.waitReady(next, 100, 1000);
  setTimeout(() => { mask._style.display = 'none'; }, 80);
  await maskedWait;
  assert(Date.now() - maskedStart >= 170, 'visible loading mask must clear before the stability window starts');

  assert(!source.includes('最大等待4秒'), 'legacy fixed four-second polling must be removed');
  assert(!source.includes('自动确认，正在重试下一单'), 'state-changed warning must not be auto-dismissed and retried');
  assert(source.includes('Success dialog detected after'), 'timing diagnostics should distinguish plugin delay from site loading');
  assert(source.includes('后续为网站加载'), 'user-facing status should distinguish click timing from site loading');

  console.log('Auto-review next-order synchronization tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
