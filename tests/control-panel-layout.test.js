const assert = require('assert');
const fs = require('fs');

const autoReviewSource = fs.readFileSync('src/auto-review.js', 'utf8');
const sttSource = fs.readFileSync('src/stt.js', 'utf8');

const panelStart = autoReviewSource.lastIndexOf('    function autoReviewCreatePanel()');
const panelEnd = autoReviewSource.indexOf('    function sjRecordingCreateOpenButton()', panelStart);
assert(panelStart > 0 && panelEnd > panelStart, 'control-panel implementation not found');
const panelSource = autoReviewSource.slice(panelStart, panelEnd);

assert(panelSource.includes("const skipBtn = document.createElement('button');"),
    'skip control must be a standalone button');
assert(!panelSource.includes("makePanelBtn(\n            'sj-skip-order-btn'"),
    'skip control must not be appended through the main-panel button factory');
assert(panelSource.includes("right: '70px'"),
    'main panel must leave room for the standalone button on its right');
assert(panelSource.includes('syncSkipButtonPosition();'),
    'standalone skip button must follow panel dragging');
assert(panelSource.includes('document.body.appendChild(skipBtn);'),
    'standalone skip button must be mounted next to, not inside, the panel');
assert(sttSource.includes("document.getElementById('sj-skip-order-btn')"),
    'standalone skip button must be removed when leaving an order page');

console.log('Control-panel standalone skip-button tests passed');
