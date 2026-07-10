const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('src/stt.js', 'utf8');
const cut = source.indexOf('    function sttFormatBusinessClues');
assert(cut > 0, 'could not isolate STT clue functions');

global.sttCurrentOrderTranscripts = {};
const api = Function(`${source.slice(0, cut)}\nreturn {
  nativeUseful: sttNativeHasUsefulBusinessSignal,
  analyze: sttAnalyzeBusinessClues
};`)();

const segs = text => [{ start: 0, end: 30, text }];
const cases = [
  {
    name: 'unrelated long conversation',
    segments: segs('老板不在家，微信收款三十元。中间说了很多无关的话。刘医生呢。今天没有别的事情。'),
    expected: false
  },
  {
    name: 'price homophones',
    segments: segs('请问卖动一生能卖多少钱？七块。'),
    expected: true,
    kind: 'price'
  },
  {
    name: 'inventory homophones',
    segments: segs('请问麦豆仓库里一共几件货？还有三十件。'),
    expected: true,
    kind: 'stock'
  }
];

for (const testCase of cases) {
  const analysis = api.analyze(testCase.segments, `test://${testCase.name}`);
  const hasCards = analysis.price.length > 0 || analysis.stock.length > 0;
  assert.strictEqual(api.nativeUseful(testCase.segments), hasCards, `${testCase.name}: top status and cards must agree`);
  assert.strictEqual(hasCards, testCase.expected, `${testCase.name}: unexpected match result`);
  if (testCase.kind) assert(analysis[testCase.kind].length > 0, `${testCase.name}: expected ${testCase.kind} clue`);
}

assert(!source.includes('原生字幕已命中业务词，未调用AI'), 'generic unexplained match status must be removed');
assert(source.includes('原生字幕命中：${matchedKinds.join'), 'status must name Q10/Q15 match kinds');
assert(source.includes('已回退原生字幕；未发现价格/库存线索'), 'fallback status must not claim a match');

console.log('STT status/card consistency tests passed');
