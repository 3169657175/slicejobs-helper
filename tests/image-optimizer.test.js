const assert = require('assert');

// Mock a clean environment
global.URL = require('url').URL;

// We read and evaluate image-optimizer.js in the context
const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname, '../src/image-optimizer.js'), 'utf8');

// Simple vm execution mock
const vm = require('vm');
const context = {
    URL: global.URL,
    console,
    Node: { ELEMENT_NODE: 1 },
    document: {
        body: {
            addEventListener: () => {}
        },
        querySelector: () => null
    },
    MutationObserver: class {
        constructor(callback) { this.callback = callback; }
        observe() {}
    }
};
vm.createContext(context);
vm.runInContext(code, context);

// Test sjOptimizeImageUrlForPreview
const optimize = context.sjOptimizeImageUrlForPreview;
const original = context.sjGetOriginalImageUrl;

console.log('[Test] Testing sjOptimizeImageUrlForPreview...');

// Case 1: Simple Aliyun OSS URL without parameters
const url1 = 'https://sjimgpub.slicejobs.com/algapp/order/type_4/285/7587/46697011/46697011_8.jpg';
const res1 = decodeURIComponent(optimize(url1));
assert.ok(res1.includes('x-oss-process=image/resize,w_1000/format,webp/quality,q_80'));

// Case 2: Aliyun OSS URL with existing resize thumbnail parameters
const url2 = 'https://sjimgpub.slicejobs.com/algapp/order/type_4/285/7587/46697011/46697011_8.jpg?x-oss-process=image/resize,m_pad,w_75,h_75,color_FFFFFF';
const res2 = decodeURIComponent(optimize(url2));
assert.ok(res2.includes('x-oss-process=image/resize'));
assert.ok(res2.includes('w_1000'));
assert.ok(res2.includes('format,webp'));
assert.ok(res2.includes('quality,q_80'));
assert.ok(!res2.includes('w_75'));
assert.ok(!res2.includes('h_75'));

// Case 3: URL from non-slicejobs domain should be ignored
const url3 = 'https://google.com/image.jpg';
const res3 = optimize(url3);
assert.strictEqual(res3, url3);

// Test sjGetOriginalImageUrl
console.log('[Test] Testing sjGetOriginalImageUrl...');

const url4 = 'https://sjimgpub.slicejobs.com/algapp/order/type_4/285/7587/46697011/46697011_8.jpg?x-oss-process=image/resize,w_1000/format,webp/quality,q_80';
const res4 = original(url4);
assert.strictEqual(res4, 'https://sjimgpub.slicejobs.com/algapp/order/type_4/285/7587/46697011/46697011_8.jpg');

console.log('✅ Image optimizer tests passed successfully!');
