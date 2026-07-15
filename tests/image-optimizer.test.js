const assert = require('assert');

// Mock browser global environment
global.URL = require('url').URL;
global.Node = { ELEMENT_NODE: 1 };

global.Element = class {};
global.Element.prototype.setAttribute = function(name, val) {
    this._attrs = this._attrs || {};
    this._attrs[name] = val;
};
global.Element.prototype.getAttribute = function(name) {
    this._attrs = this._attrs || {};
    return this._attrs[name] || '';
};

// We mock the prototype src property descriptor
let rawImageSrc = '';
const fakeSrcDescriptor = {
    get: function() {
        return rawImageSrc;
    },
    set: function(val) {
        rawImageSrc = val;
        this._attrs = this._attrs || {};
        this._attrs['src'] = val;
    },
    configurable: true
};

global.HTMLImageElement = class {};
Object.defineProperty(global.HTMLImageElement.prototype, 'src', fakeSrcDescriptor);

// Connect prototype chain for testing
Object.setPrototypeOf(global.HTMLImageElement.prototype, global.Element.prototype);

class FakeImage extends global.HTMLImageElement {
    constructor() {
        super();
        this.classList = {
            contains: (cls) => this._classes ? this._classes.includes(cls) : false
        };
        this.tagName = 'IMG';
        this.dataset = {};
        this._attrs = {};
    }
    closest(selector) {
        return this._parentSelector === selector;
    }
}

const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname, '../src/image-optimizer.js'), 'utf8');

const vm = require('vm');
const context = {
    URL: global.URL,
    console,
    Node: global.Node,
    HTMLImageElement: global.HTMLImageElement,
    Element: global.Element,
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

// Case 2: Aliyun OSS URL with existing resize thumbnail parameters (this should be skipped by thumbnail rule)
const url2 = 'https://sjimgpub.slicejobs.com/algapp/order/type_4/285/7587/46697011/46697011_8.jpg?x-oss-process=image/resize,m_pad,w_75,h_75,color_FFFFFF';
const res2 = optimize(url2);
assert.strictEqual(res2, url2); // Should not modify thumbnails

// Case 3: URL with l_4096 large image parameters (should replace with w_1000)
const urlLarge = 'https://sjimgpub.slicejobs.com/algapp/order/46709630.jpeg?x-oss-process=image/resize,l_4096';
const resLarge = decodeURIComponent(optimize(urlLarge));
assert.ok(resLarge.includes('x-oss-process=image/resize,w_1000/format,webp/quality,q_80'));

// Case 4: URL from non-slicejobs domain should be ignored
const url3 = 'https://google.com/image.jpg';
const res3 = optimize(url3);
assert.strictEqual(res3, url3);

// Test sjGetOriginalImageUrl
console.log('[Test] Testing sjGetOriginalImageUrl...');
const url4 = 'https://sjimgpub.slicejobs.com/algapp/order/type_4/285/7587/46697011/46697011_8.jpg?x-oss-process=image/resize,w_1000/format,webp/quality,q_80';
const res4 = original(url4);
assert.strictEqual(res4, 'https://sjimgpub.slicejobs.com/algapp/order/type_4/285/7587/46697011/46697011_8.jpg');

// Test Setter and setAttribute Hijacking
console.log('[Test] Testing property setter and setAttribute hijacks...');
context.sjInitImageOptimizer();

// Instantiate a fake image and mimic a viewer-move image
const img = new FakeImage();
img._classes = ['viewer-move'];
img._parentSelector = '.viewer-canvas';

// Trigger setter
img.src = 'https://sjimgpub.slicejobs.com/algapp/order/46709630.jpeg?x-oss-process=image/resize,l_4096';
assert.ok(decodeURIComponent(img.src).includes('quality,q_80'));

// Trigger setAttribute
img.setAttribute('src', 'https://sjimgpub.slicejobs.com/algapp/order/46709630.jpeg?x-oss-process=image/resize,l_4096');
assert.ok(decodeURIComponent(img.getAttribute('src')).includes('quality,q_80'));

// Manual override loaded flag
img.dataset.sjOriginalLoaded = 'true';
img.src = 'https://sjimgpub.slicejobs.com/algapp/order/46709630.jpeg';
assert.strictEqual(img.src, 'https://sjimgpub.slicejobs.com/algapp/order/46709630.jpeg');

console.log('✅ Image optimizer setter & hijack tests passed successfully!');
