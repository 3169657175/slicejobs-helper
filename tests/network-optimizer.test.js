const assert = require('assert');

// Mock browser global environment
global.Node = { ELEMENT_NODE: 1 };
global.Headers = class { constructor() {} };
global.Response = class {
    constructor(body, init) {
        this.body = body;
        this.status = init.status;
    }
};

const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname, '../src/network-optimizer.js'), 'utf8');

const vm = require('vm');
const context = {
    console,
    Node: global.Node,
    Headers: global.Headers,
    Response: global.Response,
    document: {
        readyState: 'complete',
        createElement: (tag) => ({
            tagName: tag,
            getAttribute: () => '',
            setAttribute: () => {}
        }),
        head: {
            appendChild: () => {}
        },
        querySelector: () => null
    },
    Element: {
        prototype: {
            appendChild: function(child) { return child; },
            insertBefore: function(child, ref) { return child; }
        }
    },
    window: {
        fetch: () => Promise.resolve()
    },
    XMLHttpRequest: class {
        constructor() {}
    }
};
context.XMLHttpRequest.prototype = {
    open: function() {},
    send: function() {}
};

vm.createContext(context);
vm.runInContext(code, context);

// Test blocking detection
const isBlocked = context.sjIsBlockedUrl;
assert.ok(isBlocked('https://arms-retcode.aliyuncs.com/r.png'));
assert.ok(isBlocked('https://retcode.alicdn.com/retcode/bl.js'));
assert.ok(isBlocked('http://dlswbr.baidu.com/heicha/mw/abclite.js'));
assert.ok(!isBlocked('https://sjimgpub.slicejobs.com/img.jpg'));

// Test DOM node blocking decision
const shouldBlock = context.sjShouldBlockDomNode;
const mockLink = {
    nodeType: 1,
    tagName: 'LINK',
    getAttribute: (attr) => {
        if (attr === 'rel') return 'prefetch';
        if (attr === 'href') return '/static/js/app-popup-table.js';
        return '';
    }
};
assert.ok(shouldBlock(mockLink));

const mockScript = {
    nodeType: 1,
    tagName: 'SCRIPT',
    getAttribute: (attr) => {
        if (attr === 'src') return 'https://retcode.alicdn.com/retcode/bl.js';
        return '';
    }
};
assert.ok(shouldBlock(mockScript));

console.log('✅ Network optimizer unit tests passed successfully!');
