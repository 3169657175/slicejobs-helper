const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('src/auto-review.js', 'utf8');
const start = source.indexOf("    const SJ_PREFETCH_SLOT_KEY = 'sj_prefetch_single_slot_v2';");
assert(start > 0, 'single-slot prefetch block not found');
const block = source.slice(start);

function createStorage() {
    const values = new Map();
    return {
        getItem(key) { return values.has(key) ? values.get(key) : null; },
        setItem(key, value) { values.set(key, String(value)); },
        removeItem(key) { values.delete(key); },
        keys() { return [...values.keys()]; }
    };
}

const localStorage = createStorage();
const sessionStorage = createStorage();
const location = {
    pathname: '/order/review/100',
    assigned: null,
    assign(url) {
        this.assigned = url;
        this.pathname = url;
    }
};
const store = {
    state: { orderReview: { orderDetail: { projectid: 42 } } }
};
const document = {
    querySelector(selector) {
        return selector === '#app' ? { __vue__: { $store: store, $parent: null } } : null;
    }
};

let requestCount = 0;
const window = {
    request: {
        common(name, payload) {
            assert.strictEqual(name, 'createAuditTask');
            assert.strictEqual(payload.projectid, 42);
            requestCount += 1;
            return Promise.resolve({ data: { orderid: requestCount === 1 ? 200 : 300 } });
        }
    }
};
const toasts = [];
const fakeSetTimeout = () => 1;
const fakeClearTimeout = () => {};

const api = Function(
    'localStorage', 'sessionStorage', 'location', 'document', 'window', 'unsafeWindow',
    'autoReviewToast', 'setTimeout', 'clearTimeout',
    `${block}\nreturn {
        getProjectId: sjGetActiveProjectId,
        prefetch: sjPrefetchNextOrder,
        readSlot: sjReadPrefetchSlot,
        arm: sjArmPrefetchJump,
        handleSubmit: sjHandleAuditSubmitResponse,
        finalize: sjFinalizePrefetchSlotForCurrentOrder
    };`
)(
    localStorage, sessionStorage, location, document, window, undefined,
    (message) => toasts.push(message), fakeSetTimeout, fakeClearTimeout
);

(async () => {
    assert.strictEqual(api.getProjectId(), 42, 'project id should come from the Vue root store');

    assert.strictEqual(await api.prefetch('100', 42), true, 'first order should fill the empty slot');
    assert.strictEqual(requestCount, 1);
    assert.deepStrictEqual(api.readSlot().state, 'ready');
    assert.strictEqual(api.readSlot().nextOrderId, '200');

    assert.strictEqual(await api.prefetch('100', 42), false, 'a filled slot must suppress another allocation');
    assert.strictEqual(requestCount, 1, 'repeated two-second initialization must not allocate twice');

    assert.strictEqual(api.arm(), true, 'confirm click should arm an available slot');
    assert.strictEqual(api.handleSubmit({ status: 500, responseText: '{"code":500}' }), false);
    assert.strictEqual(location.assigned, null, 'failed submission must not navigate');
    assert.strictEqual(api.readSlot().state, 'ready', 'failed submission must keep the slot');

    assert.strictEqual(api.handleSubmit({ status: 200, responseText: '{"code":0}' }), true);
    assert.strictEqual(location.assigned, '/order/review/200');
    assert.strictEqual(api.readSlot().state, 'consuming', 'successful submission consumes the only slot');

    assert.strictEqual(api.finalize('200'), null, 'arrival at the prefetched order clears the consumed slot');
    assert.strictEqual(api.readSlot(), null);

    assert.strictEqual(await api.prefetch('200', 42), true, 'the new order may fill one new slot');
    assert.strictEqual(requestCount, 2);
    assert.strictEqual(api.readSlot().nextOrderId, '300');
    assert.strictEqual(localStorage.keys().filter((key) => key.includes('slot')).length, 1);
    assert.strictEqual(localStorage.keys().some((key) => key.startsWith('sj_pref_')), false,
        'legacy per-order cache keys must not be created');

    console.log('Single-slot prefetch state-machine tests passed');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
