/**
 * build.js — 爱零工审单数据助手 打包脚本
 *
 * 用法：
 *   node build.js              → 生成 dist/slicejobs.user.js（版本号读自 package.json 或 header.js）
 *   VERSION=3.8.0 node build.js → 用指定版本号覆盖
 *
 * 模块加载顺序（顺序不能改，interceptor 必须最早执行）：
 *   header.js      → ==UserScript== 元信息块
 *   interceptor.js → XHR/fetch 拦截器（必须最先运行）
 *   storage.js     → 全局状态 + localStorage 读写封装
 *   styles.js      → 字体注入 + GM_addStyle CSS
 *   hud.js         → 悬浮 HUD 展示与刷新逻辑
 *   auto-review.js → 一键通过审核助手（Alt+A）
 *   stt.js         → AI 语音识别（STT）全模块
 *   stats.js       → 统计数据拉取、渲染、ECharts 图表
 *   bootstrap.js   → 入口启动（startHelper + 事件监听）
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const SRC  = path.join(__dirname, 'src');
const DIST = path.join(__dirname, 'dist');

// 模块顺序（严格顺序，不可随意调整）
const ORDER = [
    'header.js',
    'interceptor.js',
    'storage.js',
    'styles.js',
    'hud.js',
    'auto-review.js',
    'image-optimizer.js',
    'network-optimizer.js',
    'stt.js',
    'stats.js',
    'bootstrap.js',
];

// 读取版本号（优先用环境变量，其次从 header.js 解析）
function getVersion() {
    if (process.env.VERSION) return process.env.VERSION;
    const header = fs.readFileSync(path.join(SRC, 'header.js'), 'utf8');
    const m = header.match(/@version\s+([\d.]+)/);
    return m ? m[1] : '0.0.0';
}

function build() {
    fs.mkdirSync(DIST, { recursive: true });

    const version = getVersion();

    // 读取所有模块
    const parts = ORDER.map(filename => {
        const filepath = path.join(SRC, filename);
        if (!fs.existsSync(filepath)) {
            throw new Error(`模块文件不存在：${filepath}`);
        }
        const content = fs.readFileSync(filepath, 'utf8');
        return `// ===== ${filename} =====\n${content}`;
    });

    // header.js 不需要前缀注释，直接使用原文（去掉 "// ===== header.js =====" 前缀）
    parts[0] = fs.readFileSync(path.join(SRC, 'header.js'), 'utf8');

    // 拼接：header + IIFE 包裹体
    const iifeParts = parts.slice(1).join('\n\n');
    const output = `${parts[0]}\n(/* @global echarts */ function() {\n    'use strict';\n\n${iifeParts}\n})();\n`;

    // 版本号注入（如果是通过环境变量覆盖的）
    const finalOutput = process.env.VERSION
        ? output.replace(/(@version\s+)[\d.]+/, `$1${version}`)
        : output;

    // 构建成功必须同时保证最终油猴脚本可以被 JavaScript 引擎解析。
    // 避免编码损坏或引号缺失时仍然生成一个“看似成功”的不可运行文件。
    new vm.Script(finalOutput, { filename: 'dist/slicejobs.user.js' });

    const outPath = path.join(DIST, 'slicejobs.user.js');
    fs.writeFileSync(outPath, finalOutput, 'utf8');

    const lines  = finalOutput.split('\n').length;
    const bytes  = Buffer.byteLength(finalOutput, 'utf8');
    const kb     = (bytes / 1024).toFixed(1);

    console.log(`✅ 打包完成 → dist/slicejobs.user.js`);
    console.log(`   版本：${version}`);
    console.log(`   行数：${lines}`);
    console.log(`   大小：${kb} KB`);
    console.log(`   模块：${ORDER.length} 个`);
}

try {
    build();
} catch (err) {
    console.error('❌ 打包失败：', err.message);
    process.exit(1);
}
