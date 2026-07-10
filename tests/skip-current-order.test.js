const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('src/auto-review.js', 'utf8');
const start = source.indexOf("    const SJ_PREFETCH_SLOT_KEY = 'sj_prefetch_single_slot_v2';");
assert(start > 0, 'prefetch and skip state-machine block not found');
const block = source.slice(start);

function createStorage() {
    const values = new Map();
    return {
        getItem(key) { return values.has(key) ? values.get(key) : null; },
        setItem(key, value) { values.set(key, String(value)); },
        removeItem(key) { values.delete(key); }
    };
}

const localStorage = createStorage();
const sessionStorage = createStorage();
const location = {
    pathname: '/order/review/100',
    assigned: [],
    assign(url) {
        this.assigned.push(url);
        this.pathname = url;
    }
};
const document = { querySelector() { return null; } };
let acquireCount = 0;
const window = {
    request: {
        common(name, payload) {
            assert.strictEqual(name, 'createAuditTask');
            assert.strictEqual(payload.projectid, 42);
            acquireCount += 1;
            return Promise.resolve({ data: { orderid: 400 } });
        }
    }
};
const toasts = [];

const api = Function(
    'localStorage', 'sessionStorage', 'location', 'document', 'window', 'unsafeWindow',
    'autoReviewToast', 'getComputedStyle', 'autoReviewSleep', 'autoReviewClickEl',
    `${block}\nreturn {
        handlePending: sjHandlePendingSkipNavigation,
        readSlot: sjReadPrefetchSlot
    };`
)(
    localStorage, sessionStorage, location, document, window, undefined,
    (message) => toasts.push(message),
    () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    () => Promise.resolve(),
    () => true
);

(async () => {
    const now = Date.now();
    localStorage.setItem('sj_prefetch_single_slot_v2', JSON.stringify({
        state: 'ready', nextOrderId: '200', projectId: '42', createdAt: now
    }));
    localStorage.setItem('sj_skip_pending_v1', JSON.stringify({
        state: 'acquiring', currentOrderId: '100', projectId: '42', createdAt: now
    }));

    assert.strictEqual(await api.handlePending(), true, 'ready slot should be consumed first');
    assert.strictEqual(location.assigned.at(-1), '/order/review/200');
    assert.strictEqual(api.readSlot().state, 'consuming');
    assert.strictEqual(localStorage.getItem('sj_skip_pending_v1'), null);
    assert.strictEqual(acquireCount, 0, 'ready slot must avoid another allocation');

    localStorage.removeItem('sj_prefetch_single_slot_v2');
    location.pathname = '/order/review/300';
    localStorage.setItem('sj_skip_pending_v1', JSON.stringify({
        state: 'acquiring', currentOrderId: '300', projectId: '42', createdAt: Date.now()
    }));

    assert.strictEqual(await api.handlePending(), true, 'empty slot should acquire one next order');
    assert.strictEqual(acquireCount, 1);
    assert.strictEqual(location.assigned.at(-1), '/order/review/400');
    assert.strictEqual(localStorage.getItem('sj_skip_pending_v1'), null);

    assert(source.includes("'sj-skip-order-btn'"), 'control panel must include the skip button');
    assert(source.includes('await sjWaitForCancelOccupySuccess'),
        'navigation must wait for confirmed cancellation');

    console.log('Skip-current-order workflow tests passed');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
