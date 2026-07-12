// ==UserScript==
// @name         爱零工审单数据助手 (SliceJobs Audit Stats Helper)
// @namespace    http://tampermonkey.net/
// @version      3.9.11
// @description  统计每日及每小时审核订单量，支持日期切换。内置一键通过审核助手（Alt+A）与AI语音重识别字幕（SenseVoice）。
// @author       Antigravity
// @match        *://admin2.slicejobs.com/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/echarts/5.4.3/echarts.min.js
// @require      https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      api.groq.com
// @connect      api.siliconflow.cn
// @connect      sjaudiopub.slicejobs.com
// @run-at       document-end
// ==/UserScript==

(/* @global echarts */ function() {
    'use strict';

// ===== interceptor.js =====
(/* @global echarts */ function() {
    'use strict';

    // ============================================================
    // 网络拦截器：捕获音频 URL，并在已授权的一键审核提交成功后通知单槽跳转。
    // ============================================================
    (function installAudioInterceptor() {
        const AUDIO_CDN_RE = /https?:\/\/sjaudiopub\.slicejobs\.com\/[^"'\s\\<>\]]+/g;
        const seenUrls = new Set();

        function onAudioUrlFound(rawUrl) {
            const clean = rawUrl.replace(/['"\\<>]+.*$/, '').replace(/^http:\/\//i, 'https://');
            if (!clean || seenUrls.has(clean)) return;
            if (!location.pathname.startsWith('/order/review')) return;
            seenUrls.add(clean);
            console.log('[STT Network] Intercepted audio URL:', clean);
            const tryProcess = (retries) => {
                if (typeof sttSilentProcess === 'function') {
                    sttSilentProcess(clean);
                } else if (retries > 0) {
                    setTimeout(() => tryProcess(retries - 1), 200);
                }
            };
            setTimeout(() => tryProcess(20), 50);
        }

        function scanText(text) {
            if (!text || !text.includes('sjaudiopub')) return;
            const matches = text.match(AUDIO_CDN_RE);
            if (matches) matches.forEach(onAudioUrlFound);
        }

        function isAuditSubmitRequest(url, method) {
            if (String(method || '').toUpperCase() !== 'POST') return false;
            const value = String(url || '');
            return (value.includes('/admin/order/audit/') || value.includes('/admin/audit_task/')) &&
                !['/acquire', '/create', '/get', '/detail', '/history', '/info', '/query']
                    .some((part) => value.includes(part));
        }

        function notifyAuditSubmit(meta) {
            setTimeout(() => {
                if (typeof sjHandleAuditSubmitResponse === 'function') {
                    sjHandleAuditSubmitResponse(meta);
                }
            }, 0);
        }

        const origOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url, ...rest) {
            this._sjUrl = url;
            this._sjMethod = method;
            return origOpen.call(this, method, url, ...rest);
        };
        const origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function(...args) {
            this.addEventListener('load', function() {
                const responseText = typeof this.responseText === 'string' ? this.responseText : '';
                scanText(responseText);
                if (isAuditSubmitRequest(this._sjUrl, this._sjMethod)) {
                    notifyAuditSubmit({
                        url: this._sjUrl,
                        status: this.status,
                        responseText
                    });
                }
            });
            return origSend.call(this, ...args);
        };

        const origFetch = window.fetch;
        if (origFetch) {
            window.fetch = function(input, initOptions, ...args) {
                const url = typeof input === 'string' ? input : input && input.url || '';
                const method = initOptions && initOptions.method || input && input.method || 'GET';
                return origFetch.call(this, input, initOptions, ...args).then((response) => {
                    try {
                        response.clone().text().then((text) => {
                            scanText(text);
                            if (isAuditSubmitRequest(url, method)) {
                                notifyAuditSubmit({ url, status: response.status, responseText: text });
                            }
                        }).catch(() => {});
                    } catch (error) {}
                    // 立即把响应交还网站，避免插件阻塞网站自己的审核状态更新。
                    return response;
                });
            };
        }
    })();



// ===== storage.js =====
﻿    // 判断是否为初审工单 (v3.6)
    // 接口字段 review 代表当前工单的审核轮次：0 表示初审；>=1 表示复审单。
    // 如果没有 review 字段，默认为初审。
    const isFirstRoundAudit = (item) => {
        if (item && item.review !== undefined && item.review !== null) {
            return parseInt(item.review, 10) === 0;
        }
        return true;
    };

    // 全局状态
    let currentDate = new Date();
    let chartInstance = null;
    let currentDayStats = null;    // 缓存当前加载日期的统计数据以供导出
    let currentWeeklyStats = null; // 缓存当前加载周期的统计数据以供导出
    let currentTab = 'daily';      // 当前标签页: 'daily' | 'weekly'
    let resizeHandler = null;      // 全局共享的 resize 处理器，防内存泄漏
    const queryCache = {};         // 内存缓存 API 请求，防接口高频被限流
    let autoRefreshInterval = null; // 自动刷新定时器
    let sttCurrentOrderTranscripts = {}; // AI 语音识别当前工单的转写文本缓存
    let sttLastLocationHref = null; // 上次检测的页面 URL
    let sttManuallyExpanded = new Set(); // 手动展开的题目编号列表 (如 Q1, Q2 等)

    // 每日审核目标独立存储与管理 (v2.9)
    const getTargetForDate = (dateStr) => {
        try {
            const targetsJson = localStorage.getItem('sj_stats_targets_by_date');
            if (targetsJson) {
                const targetsMap = JSON.parse(targetsJson);
                if (targetsMap[dateStr]) {
                    const targetVal = parseInt(targetsMap[dateStr], 10);
                    if (!isNaN(targetVal) && targetVal > 0) {
                        return targetVal;
                    }
                }
            }
        } catch (e) {
            console.warn("Failed to read sj_stats_targets_by_date:", e);
        }
        // 回退默认目标
        return parseInt(localStorage.getItem('sj_stats_target') || '200', 10);
    };

    const setTargetForDate = (dateStr, targetVal) => {
        let targetsMap = {};
        try {
            const targetsJson = localStorage.getItem('sj_stats_targets_by_date');
            if (targetsJson) {
                targetsMap = JSON.parse(targetsJson);
            }
        } catch (e) {
            console.warn("Failed to parse targets map, resetting:", e);
        }

        targetsMap[dateStr] = targetVal;
        localStorage.setItem('sj_stats_targets_by_date', JSON.stringify(targetsMap));
        // 也同步更新全局默认目标，以便作为未来日期的新默认值
        localStorage.setItem('sj_stats_target', targetVal);
    };

    // 每日最高审核量观测记录与管理 (v3.4 遗留，用于向下兼容 v3.5 的历史退单数据)
    const getMaxObservedForDate = (dateStr) => {
        try {
            const dataJson = localStorage.getItem('sj_stats_max_observed_counts');
            if (dataJson) {
                const map = JSON.parse(dataJson);
                if (map && typeof map === 'object' && map[dateStr]) {
                    const val = parseInt(map[dateStr], 10);
                    if (!isNaN(val) && val > 0) {
                        return val;
                    }
                }
            }
        } catch (e) {
            console.warn("Failed to read sj_stats_max_observed_counts:", e);
        }
        return 0;
    };

    const setMaxObservedForDate = (dateStr, count) => {
        try {
            let map = {};
            const dataJson = localStorage.getItem('sj_stats_max_observed_counts');
            if (dataJson) {
                try {
                    const parsed = JSON.parse(dataJson);
                    if (parsed && typeof parsed === 'object') {
                        map = parsed;
                    }
                } catch (err) {
                    console.warn("Failed to parse map, using empty map:", err);
                }
            }
            map[dateStr] = count;
            localStorage.setItem('sj_stats_max_observed_counts', JSON.stringify(map));
        } catch (e) {
            console.warn("Failed to set sj_stats_max_observed_counts:", e);
        }
    };

    // 每日已观测审核工单 ID 集合管理 (v3.5, v3.6 过滤自愈历史污染日期字符串)
    const getObservedIdsForDate = (dateStr) => {
        try {
            const dataJson = localStorage.getItem('sj_stats_observed_ids_by_date');
            if (dataJson) {
                const map = JSON.parse(dataJson);
                if (map && typeof map === 'object' && map[dateStr] && Array.isArray(map[dateStr])) {
                    // 过滤掉因为旧版(v3.4)无 id 缓存而混入的 reviewedtime 格式 ID (带横杠和冒号的日期时间字符串)
                    const cleaned = map[dateStr].filter(id => {
                        if (typeof id === 'string' && id.includes('-') && id.includes(':')) {
                            return false;
                        }
                        return true;
                    });
                    return cleaned;
                }
            }
        } catch (e) {
            console.warn("Failed to read sj_stats_observed_ids_by_date:", e);
        }
        return [];
    };

    const setObservedIdsForDate = (dateStr, idsList) => {
        try {
            let map = {};
            const dataJson = localStorage.getItem('sj_stats_observed_ids_by_date');
            if (dataJson) {
                try {
                    const parsed = JSON.parse(dataJson);
                    if (parsed && typeof parsed === 'object') {
                        map = parsed;
                    }
                } catch (err) {
                    console.warn("Failed to parse map, using empty map:", err);
                }
            }
            // 同样过滤后再写入，保持数据纯净
            map[dateStr] = idsList.filter(id => {
                if (typeof id === 'string' && id.includes('-') && id.includes(':')) {
                    return false;
                }
                return true;
            });
            localStorage.setItem('sj_stats_observed_ids_by_date', JSON.stringify(map));
        } catch (e) {
            console.warn("Failed to set sj_stats_observed_ids_by_date:", e);
        }
    };

    // 清洗已观测 ID 集合，移除非数字ID，以及把由于时区等差异被错误归类到其它日期的 ID 剔除 (v3.6.1 自愈自净化)
    const sanitizeAllObservedIds = (allRecords) => {
        try {
            const dataJson = localStorage.getItem('sj_stats_observed_ids_by_date');
            if (!dataJson) return;
            const map = JSON.parse(dataJson);
            if (!map || typeof map !== 'object') return;

            // 1. 建立 ID 到实际日期(YYYY-MM-DD)的映射关系
            const idToDateMap = new Map();
            allRecords.forEach(item => {
                const id = item.id || item.orderid || item.taskid;
                if (id && item.reviewedtime) {
                    const dateStr = item.reviewedtime.substring(0, 10);
                    idToDateMap.set(String(id), dateStr);
                    idToDateMap.set(Number(id), dateStr);
                }
            });

            let changed = false;
            // 2. 遍历 localStorage 中的每个日期
            for (const dateStr in map) {
                if (Array.isArray(map[dateStr])) {
                    const originalLength = map[dateStr].length;
                    const cleaned = map[dateStr].filter(id => {
                        // 过滤掉因为旧版(v3.4)无 id 缓存而混入的 reviewedtime 格式 ID (带横杠和冒号的日期时间字符串)
                        if (typeof id === 'string' && id.includes('-') && id.includes(':')) {
                            return false;
                        }
                        // 如果该 ID 存在于我们拉取的实际记录中，但其实际审核日期不等于当前分组日期，则说明是跨天污染，予以过滤剔除
                        const realDate = idToDateMap.get(id);
                        if (realDate && realDate !== dateStr) {
                            return false;
                        }
                        return true;
                    });
                    if (cleaned.length !== originalLength) {
                        map[dateStr] = cleaned;
                        changed = true;
                    }
                }
            }
            if (changed) {
                localStorage.setItem('sj_stats_observed_ids_by_date', JSON.stringify(map));
                console.log("Sanitized sj_stats_observed_ids_by_date successfully.");
            }
        } catch (e) {
            console.warn("Failed to sanitize observed IDs:", e);
        }
    };



// ===== styles.js =====
﻿    // 动态注入 Google Fonts 字体
    const fontLink = document.createElement('link');
    fontLink.rel = 'stylesheet';
    fontLink.href = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap';
    document.head.appendChild(fontLink);

    // 样式注入 (UI 3.4)
    GM_addStyle(`
        /* 悬浮球容器样式 */
        #sj-stats-float-btn {
            position: fixed;
            bottom: 24px;
            right: 24px;
            background: rgba(15, 23, 42, 0.95);
            backdrop-filter: blur(12px);
            border: 1px solid rgba(59, 130, 246, 0.4);
            box-shadow: 0 4px 20px rgba(59, 130, 246, 0.25);
            color: #3b82f6;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            z-index: 99999;
            transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            user-select: none;
            box-sizing: border-box;
            overflow: hidden;
            white-space: nowrap;
        }

        /* 迷你模式 */
        #sj-stats-float-btn.sj-hud-min {
            width: 56px;
            height: 56px;
            border-radius: 50%;
            overflow: visible;
        }
        #sj-stats-float-btn.sj-hud-min:hover {
            transform: scale(1.1) translateY(-3px);
            border-color: #60a5fa;
            box-shadow: 0 8px 30px rgba(59, 130, 246, 0.5);
            color: #60a5fa;
        }

        /* 展开 HUD 状态条模式 */
        #sj-stats-float-btn.sj-hud-exp {
            width: auto;
            height: 38px;
            border-radius: 19px;
            padding: 0 16px;
            gap: 12px;
            min-width: 290px;
            overflow: hidden;
        }
        #sj-stats-float-btn.sj-hud-exp:hover {
            border-color: #60a5fa;
            box-shadow: 0 6px 24px rgba(59, 130, 246, 0.45);
        }

        #sj-stats-float-btn.sj-dragging {
            transition: none !important;
            cursor: grabbing !important;
            transform: none !important;
        }
        #sj-stats-float-btn svg {
            width: 20px;
            height: 20px;
            fill: currentColor;
        }

        /* HUD 文本与样式 */
        .sj-hud-text {
            font-size: 11.5px;
            color: #cbd5e1;
            font-weight: 500;
        }
        .sj-hud-divider {
            color: rgba(255, 255, 255, 0.12);
            font-weight: 300;
        }

        /* 进度徽标样式 */
        #sj-stats-badge {
            position: absolute;
            top: -5px;
            right: -5px;
            background: rgba(9, 13, 22, 0.95);
            border: 1px solid rgba(59, 130, 246, 0.5);
            box-shadow: 0 0 10px rgba(59, 130, 246, 0.3);
            color: #3b82f6;
            font-size: 10px;
            font-weight: 700;
            padding: 1px 5px;
            border-radius: 10px;
            pointer-events: none;
            white-space: nowrap;
            display: none;
            transition: all 0.3s ease;
            font-family: 'Plus Jakarta Sans', sans-serif;
            z-index: 100000;
        }
        #sj-stats-badge.met {
            border-color: rgba(16, 185, 129, 0.6);
            color: #10b981;
            box-shadow: 0 0 12px rgba(16, 185, 129, 0.45);
        }

        /* 模态框遮罩 */
        #sj-stats-modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(2, 6, 23, 0.75);
            backdrop-filter: blur(12px);
            z-index: 100000;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.3s ease;
        }
        #sj-stats-modal-overlay.active {
            opacity: 1;
            pointer-events: auto;
        }

        /* 模态框卡片 (暗黑玻璃拟态) */
        #sj-stats-card {
            background: #090d16;
            color: #f1f5f9;
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 20px;
            width: 720px;
            max-width: 95%;
            max-height: 90vh;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 50px rgba(59, 130, 246, 0.04);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
            transform: scale(0.92);
            transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        #sj-stats-modal-overlay.active #sj-stats-card {
            transform: scale(1);
        }

        /* 头部设计 */
        .sj-card-header {
            background: linear-gradient(180deg, rgba(255,255,255,0.02) 0%, transparent 100%);
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
            padding: 20px 24px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            position: relative;
        }
        .sj-card-title {
            margin: 0;
            font-size: 17px;
            font-weight: 700;
            background: linear-gradient(135deg, #ffffff 0%, #94a3b8 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            letter-spacing: 0.5px;
        }
        .sj-card-close {
            background: none;
            border: none;
            color: #475569;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 4px;
            border-radius: 6px;
            transition: all 0.2s;
        }
        .sj-card-close:hover {
            background: rgba(255, 255, 255, 0.05);
            color: #ffffff;
        }
        .sj-card-close svg {
            width: 18px;
            height: 18px;
            fill: currentColor;
        }

        /* 日期选择器容器 */
        .sj-date-picker-bar {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            background: rgba(255, 255, 255, 0.01);
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
            padding: 12px 24px;
        }
        .sj-date-btn {
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 8px;
            padding: 7px 14px;
            font-size: 13px;
            font-weight: 600;
            color: #94a3b8;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 4px;
            transition: all 0.2s;
            user-select: none;
        }
        .sj-date-btn:hover:not(:disabled) {
            background: rgba(255, 255, 255, 0.08);
            border-color: rgba(255, 255, 255, 0.2);
            color: #ffffff;
        }
        .sj-date-btn:disabled {
            opacity: 0.2;
            cursor: not-allowed;
        }
        .sj-date-btn svg {
            width: 14px;
            height: 14px;
            fill: currentColor;
        }
        .sj-date-input {
            border: 1px solid rgba(255, 255, 255, 0.10);
            border-radius: 8px;
            padding: 6px 12px;
            font-size: 13px;
            font-weight: 600;
            color: #ffffff;
            outline: none;
            background: rgba(15, 23, 42, 0.6);
            cursor: pointer;
            text-align: center;
            font-family: inherit;
            color-scheme: dark;
            transition: border-color 0.2s;
        }
        .sj-date-input:focus {
            border-color: #3b82f6;
        }

        /* 内容区域 */
        .sj-card-body {
            padding: 24px;
            overflow-y: auto;
            color: #cbd5e1;
            display: flex;
            flex-direction: column;
            gap: 24px;
        }

        /* 自定义窄滚动条 */
        .sj-card-body::-webkit-scrollbar {
            width: 6px;
        }
        .sj-card-body::-webkit-scrollbar-track {
            background: transparent;
        }
        .sj-card-body::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.08);
            border-radius: 3px;
        }
        .sj-card-body::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, 0.18);
        }

        /* 统计区块 (高品质卡片) */
        .sj-stats-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 16px;
        }
        .sj-stats-box {
            border-radius: 16px;
            padding: 20px 16px;
            text-align: center;
            position: relative;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 6px;
            transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .sj-stats-box::before {
            content: '';
            position: absolute;
            top: 0; left: 0; width: 100%; height: 100%;
            background: linear-gradient(180deg, rgba(255,255,255,0.02) 0%, transparent 100%);
            pointer-events: none;
        }
        .sj-box-blue {
            background: rgba(15, 23, 42, 0.45);
            border: 1px solid rgba(59, 130, 246, 0.15);
            backdrop-filter: blur(8px);
        }
        .sj-box-blue:hover {
            border-color: rgba(59, 130, 246, 0.45);
            box-shadow: 0 12px 30px rgba(59, 130, 246, 0.12);
            transform: translateY(-3px);
        }
        .sj-box-purple {
            background: rgba(15, 23, 42, 0.45);
            border: 1px solid rgba(168, 85, 247, 0.15);
            backdrop-filter: blur(8px);
        }
        .sj-box-purple:hover {
            border-color: rgba(168, 85, 247, 0.45);
            box-shadow: 0 12px 30px rgba(168, 85, 247, 0.12);
            transform: translateY(-3px);
        }
        .sj-box-amber {
            background: rgba(15, 23, 42, 0.45);
            border: 1px solid rgba(245, 158, 11, 0.15);
            backdrop-filter: blur(8px);
        }
        .sj-box-amber:hover {
            border-color: rgba(245, 158, 11, 0.45);
            box-shadow: 0 12px 30px rgba(245, 158, 11, 0.12);
            transform: translateY(-3px);
        }
        .sj-stats-box-label {
            font-size: 11.5px;
            color: #64748b;
            font-weight: 600;
            letter-spacing: 0.5px;
        }
        .sj-stats-box-value {
            font-size: 32px;
            font-weight: 700;
            line-height: 1;
        }
        .sj-text-blue { color: #3b82f6; text-shadow: 0 0 15px rgba(59, 130, 246, 0.3); }
        .sj-text-purple { color: #a855f7; text-shadow: 0 0 15px rgba(168, 85, 247, 0.3); }
        .sj-text-amber { color: #f59e0b; text-shadow: 0 0 15px rgba(245, 158, 11, 0.3); }

        /* 图表容器 */
        .sj-chart-wrapper {
            position: relative;
            background: rgba(255, 255, 255, 0.01);
            border: 1px solid rgba(255, 255, 255, 0.04);
            border-radius: 16px;
            padding: 16px 12px 10px 12px;
        }
        .sj-chart-title {
            font-size: 13px;
            font-weight: 600;
            margin-bottom: 4px;
            margin-left: 8px;
            color: #94a3b8;
        }
        #sj-stats-chart-div {
            width: 100%;
            height: 200px;
        }

        /* 列表明细样式 */
        .sj-details-wrapper {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .sj-details-title {
            font-size: 13px;
            font-weight: 600;
            color: #94a3b8;
        }
        .sj-details-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
        }
        .sj-details-table th, .sj-details-table td {
            padding: 11px 16px;
            text-align: left;
        }
        .sj-details-table th {
            background: rgba(255, 255, 255, 0.02);
            color: #64748b;
            font-weight: 600;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            font-size: 12px;
        }
        .sj-details-table td {
            border-bottom: 1px solid rgba(255, 255, 255, 0.03);
            color: #cbd5e1;
        }
        .sj-details-table tr:hover {
            background: rgba(255, 255, 255, 0.02);
        }

        /* 加载动画 */
        .sj-loading-overlay {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 60px 0;
        }
        .sj-spinner {
            border: 3px solid rgba(255, 255, 255, 0.04);
            width: 32px;
            height: 32px;
            border-radius: 50%;
            border-left-color: #3b82f6;
            animation: sj-spin 0.8s linear infinite;
            margin-bottom: 16px;
        }
        @keyframes sj-spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        /* 选项卡切换样式 (v1.8) */
        .sj-tab-item {
            user-select: none;
            position: relative;
            padding: 10px 4px;
            font-size: 13px;
            font-weight: 600;
            color: #64748b;
            border-bottom: 2px solid transparent;
            cursor: pointer;
            transition: all 0.2s;
            height: 100%;
            display: flex;
            align-items: center;
            box-sizing: border-box;
        }
        .sj-tab-item:hover {
            color: #f1f5f9;
        }
                .sj-tab-item.active {
            color: #3b82f6;
            border-bottom-color: #3b82f6;
        }

        /* Q10 & Q15 下方的 AI 字幕轻量提示 */
        .sj-stt-tip-box {
            background: transparent !important;
            border: none !important;
            border-radius: 0 !important;
            padding: 0 !important;
            margin: 4px 0 6px !important;
            color: #64748b !important;
            font-family: system-ui, -apple-system, sans-serif !important;
            font-size: 11px !important;
            line-height: 1.25 !important;
            box-shadow: none !important;
            animation: sj-fade-in 0.3s ease;
        }
        .sj-stt-highlight-price {
            background-color: rgba(234, 179, 8, 0.2) !important;
            color: #facc15 !important;
            padding: 1px 4px !important;
            border-radius: 3px !important;
            font-weight: bold !important;
            border: 1px solid rgba(234, 179, 8, 0.4) !important;
        }
        .sj-stt-highlight-stock {
            background-color: rgba(168, 85, 247, 0.2) !important;
            color: #c084fc !important;
            padding: 1px 4px !important;
            border-radius: 3px !important;
            font-weight: bold !important;
            border: 1px solid rgba(168, 85, 247, 0.4) !important;
        }

        /* 题目自动折叠样式 */
        .sj-collapsed-card {
            height: 38px !important;
            overflow: hidden !important;
            opacity: 0.65;
            position: relative;
            border: 1px dashed #dcdfe6 !important;
            background-color: #f5f7fa !important;
            transition: all 0.2s ease-in-out;
        }
        .sj-collapsed-card:hover {
            opacity: 1;
            background-color: #ecf5ff !important;
            border-color: #c6e2ff !important;
        }
        .sj-collapsed-card * {
            pointer-events: none !important;
        }
        .sj-collapsed-card .sj-collapse-toggle-btn {
            pointer-events: auto !important;
        }

        /* 禁用说明信息的鼠标悬停，从而拦截其 Popover 弹窗 */
        .question-detail-text.el-popover__reference,
        .question-detail-text,
        .question-detail {
            pointer-events: none !important;
            user-select: none !important;
        }
    `);
    // 全局今日数据缓存 (v2.8)


// ===== hud.js =====
    let globalTodayRecords = [];

    // 更新悬浮UI状态（迷你HUD / 经典悬浮球）(v2.8)
    const updateFloatingUI = (records) => {
        const btn = document.getElementById('sj-stats-float-btn');
        if (!btn) return;

        // 缓存今日数据以供切换HUD模式时使用
        globalTodayRecords = records;

        const todayStr = formatDate(new Date());
        const target = getTargetForDate(todayStr);
        const hourlyStats = Array.from({ length: 24 }, () => 0);
        const hourlyReworkStats = Array.from({ length: 24 }, () => 0);

        records.forEach(item => {
            if (item.reviewedtime) {
                let hour = parseInt(item.reviewedtime.substring(11, 13), 10);
                if (!isNaN(hour)) {
                    if (hour === 8) hour = 9;
                    else if (hour === 12) hour = 11;
                    else if (hour === 18) hour = 17;
                    if (hour >= 0 && hour < 24) {
                        if (isFirstRoundAudit(item)) {
                            hourlyStats[hour]++;
                        } else {
                            hourlyReworkStats[hour]++;
                        }
                    }
                }
            }
        });

        const coreHours = [9, 10, 11, 13, 14, 15, 16, 17];
        const extraHours = [];
        for (let h = 0; h < 24; h++) {
            if (hourlyStats[h] > 0 || hourlyReworkStats[h] > 0) {
                if (!coreHours.includes(h)) {
                    extraHours.push(h);
                }
            }
        }
        const displayHours = [...coreHours, ...extraHours].sort((a, b) => a - b);
        let todayFirstRound = 0;
        let todayRework = 0;
        // 统计全天所有24小时的总初审和总复审量，防止遗漏排班时段外的加班审核 (v3.6.2)
        for (let h = 0; h < 24; h++) {
            todayFirstRound += hourlyStats[h];
            todayRework += hourlyReworkStats[h];
        }
        let todayTotal = todayFirstRound + todayRework;

        // 目标达成时触发洒花特效（基于今日初审量，且每天仅触发一次）
        if (todayFirstRound >= target) {
            const firedDate = localStorage.getItem('sj_stats_confetti_fired_date');
            if (firedDate !== todayStr) {
                if (typeof confetti === 'function') {
                    confetti({
                        particleCount: 120,
                        spread: 80,
                        origin: { y: 0.6 }
                    });
                }
                localStorage.setItem('sj_stats_confetti_fired_date', todayStr);
            }
        }

        // 计算当前展示时速（与 Card 2 保持同步）
        const now = new Date();
        const nowHour = now.getHours();
        const nowMin = now.getMinutes();
        let targetHour = nowHour;
        if (nowHour === 8) targetHour = 9;
        else if (nowHour === 12) targetHour = 11;
        else if (nowHour === 18) targetHour = 17;

        const isCoreHour = displayHours.includes(targetHour);
        let curHourSpeed = '0.0';
        if (isCoreHour) {
            // 核心工时段：显示本小时（初审+复审）综合时速
            const elapsedFrac = Math.max(5, nowMin) / 60;
            const curHourTotal = (hourlyStats[targetHour] || 0) + (hourlyReworkStats[targetHour] || 0);
            curHourSpeed = (curHourTotal / elapsedFrac).toFixed(1);
        } else {
            // 非核心时段：显示今日累计综合均速（初审+复审）
            let activeHours = 0;
            displayHours.forEach(h => {
                if (hourlyStats[h] > 0 || hourlyReworkStats[h] > 0) {
                    if (h === nowHour) {
                        const fraction = Math.max(5, nowMin) / 60;
                        activeHours += fraction;
                    } else {
                        activeHours += 1.0;
                    }
                }
            });
            curHourSpeed = activeHours > 0 ? (todayTotal / activeHours).toFixed(1) : '0.0';
        }


        const mode = localStorage.getItem('sj_stats_hud_mode') || 'min';

        // 同步状态 class
        const isDragging = btn.classList.contains('sj-dragging');
        if (mode === 'exp') {
            btn.className = isDragging ? 'sj-dragging sj-hud-exp' : 'sj-hud-exp';

            const remainingVal = target - todayFirstRound;
            const remainingText = remainingVal <= 0
                ? `<span style="color: #10b981; font-weight: 700;">已达标! 🎉</span>`
                : `还差: <span style="color: #f59e0b; font-weight: 700;">${remainingVal}</span> 单`;

            const todayTextHtml = todayRework > 0
                ? `<span style="color: #3b82f6; font-weight: 700;">${todayFirstRound}</span>(<span style="color: #a855f7;">${todayTotal}</span>)/<span style="color: #64748b;">${target}</span>`
                : `<span style="color: #3b82f6; font-weight: 700;">${todayFirstRound}</span>/<span style="color: #64748b;">${target}</span>`;

            btn.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px; width: 100%; height: 100%; justify-content: center; font-family: 'Plus Jakarta Sans', sans-serif;">
                    <svg viewBox="0 0 24 24" style="width: 15px; height: 15px; fill: currentColor; flex-shrink: 0; margin-top: 1px;">
                        <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/>
                    </svg>
                    <span class="sj-hud-text" style="font-size: 11.5px; color: #cbd5e1; white-space: nowrap;">
                        初审: ${todayTextHtml}
                    </span>
                    <span class="sj-hud-divider" style="color: rgba(255, 255, 255, 0.12);">|</span>
                    <span class="sj-hud-text" style="font-size: 11.5px; color: #cbd5e1; white-space: nowrap;">
                        时速: <span style="color: #a855f7; font-weight: 700;">${curHourSpeed}</span>
                    </span>
                    <span class="sj-hud-divider" style="color: rgba(255, 255, 255, 0.12);">|</span>
                    <span class="sj-hud-text" style="font-size: 11.5px; color: #cbd5e1; white-space: nowrap;">
                        ${remainingText}
                    </span>
                </div>
            `;
        } else {
            btn.className = isDragging ? 'sj-dragging sj-hud-min' : 'sj-hud-min';
            btn.innerHTML = `
                <svg viewBox="0 0 24 24">
                    <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/>
                </svg>
                <div id="sj-stats-badge"></div>
            `;
            const badge = document.getElementById('sj-stats-badge');
            if (badge) {
                badge.innerText = `${todayFirstRound}/${target}`;
                badge.style.display = 'block';
                if (todayFirstRound >= target) {
                    badge.classList.add('met');
                } else {
                    badge.classList.remove('met');
                }
            }
        }
        btn.title = `审核数据统计助手 (Alt + S) [双击切换HUD模式]\n今日初审: ${todayFirstRound} 单\n今日复审: ${todayRework} 单\n累计总量: ${todayTotal} 单\n当前目标: ${target} 单`;
    };

        // 切换 HUD 状态 (v2.8)
    const toggleHudMode = () => {
        const currentMode = localStorage.getItem('sj_stats_hud_mode') || 'min';
        const newMode = currentMode === 'min' ? 'exp' : 'min';
        localStorage.setItem('sj_stats_hud_mode', newMode);
        updateFloatingUI(globalTodayRecords);
    };

    // 初始化加载悬浮按钮数据（静默拉取）(v2.2)
    const initFloatBadge = async () => {
        const token = localStorage.getItem('token');
        if (!token) return;
        try {
            const todayStr = formatDate(new Date());
            const records = await fetchRecordsForDate(token, todayStr);
            updateFloatingUI(records);
        } catch (e) {
            console.warn("Failed to initialize float badge count:", e);
        }
    };

    // 自动静默刷新今日数据逻辑 (v2.2支持可见性挂起)
    const startAutoRefresh = () => {
        stopAutoRefresh();
        autoRefreshInterval = setInterval(async () => {
            if (document.hidden) return; // 页面隐藏时暂停后台请求，节约带宽与防爆频

            const overlay = document.getElementById('sj-stats-modal-overlay');
            if (overlay && overlay.classList.contains('active')) {
                const token = localStorage.getItem('token');
                if (!token) return;
                const dateStr = formatDate(currentDate);
                const todayStr = formatDate(new Date());

                if (currentTab === 'daily' && dateStr === todayStr) {
                    try {
                        const popover = document.getElementById('sj-target-popover');
                        if (popover && popover.style.display === 'flex') {
                            return; // 用户正在编辑目标，先跳过此次静默刷新，避免冲突或打断输入
                        }

                        // 默默删除今日缓存，重新从网络获取今日最新数据
                        delete queryCache[dateStr];
                        const allRecords = await fetchRecordsForDate(token, dateStr);

                        // 获取昨日同期数据作对比
                        const yestDate = new Date(currentDate);
                        yestDate.setDate(yestDate.getDate() - 1);
                        const yestDateStr = formatDate(yestDate);
                        const yesterdayRecords = await fetchRecordsForDate(token, yestDateStr);

                        // 二次校验确认弹窗没被打开且面板依然处于active，再进行静默重绘
                        const activeOverlay = document.getElementById('sj-stats-modal-overlay');
                        const activePopover = document.getElementById('sj-target-popover');
                        if (activeOverlay && activeOverlay.classList.contains('active') && (!activePopover || activePopover.style.display !== 'flex')) {
                            renderStats(allRecords, yesterdayRecords);
                        }
                    } catch (err) {
                        console.warn("Silent auto-refresh failed:", err);
                    }
                }
            }
        }, 15000);
    };

    const stopAutoRefresh = () => {
        if (autoRefreshInterval) {
            clearInterval(autoRefreshInterval);
            autoRefreshInterval = null;
        }
    };

    // 全局定时刷新处理器 (v2.8)
    const startBackgroundRefresh = () => {
        // 每 30 秒静默刷新一次今日数据（仅当页面可见且大面板关闭时运行，以防请求频繁）
        setInterval(async () => {
            if (document.hidden) return;
            const overlay = document.getElementById('sj-stats-modal-overlay');
            const overlayActive = overlay && overlay.classList.contains('active');

            // 如果面板已经打开，交由面板的 15s 高频刷新逻辑处理，这里直接跳过
            if (overlayActive) return;

            const token = localStorage.getItem('token');
            if (!token) return;

            try {
                const todayStr = formatDate(new Date());
                delete queryCache[todayStr]; // 清除今日缓存以重新拉取
                const records = await fetchRecordsForDate(token, todayStr);
                updateFloatingUI(records);
            } catch (err) {
                console.warn("Background HUD refresh failed:", err);
            }
        }, 30000);
    };

    // ==========================================


// ===== auto-review.js =====
    // 一键通过审核助手功能组 (无 this 闭包版本)
    // ==========================================
    let autoReviewToastEl = null;
    let autoReviewRunning = false; // ③ 执行锁，防止并发触发

    function autoReviewSleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    // 触发点击（mousedown+mouseup+click）
    function autoReviewClickEl(el) {
        if (!el) return false;
        const opts = { bubbles: true, cancelable: true };
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        el.dispatchEvent(new MouseEvent('mouseup', opts));
        el.dispatchEvent(new MouseEvent('click', opts));
        return true;
    }

    // 带坐标点击星级以实现满星选择
    function autoReviewClickStarAt(iconEl, ratio = 1) {
        const rect = iconEl.getBoundingClientRect();
        const x = rect.left + rect.width * ratio - 1;
        const y = rect.top + rect.height / 2;
        const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y };
        iconEl.dispatchEvent(new MouseEvent('mousemove', opts));
        iconEl.dispatchEvent(new MouseEvent('mousedown', opts));
        iconEl.dispatchEvent(new MouseEvent('mouseup', opts));
        iconEl.dispatchEvent(new MouseEvent('click', opts));
    }

    // 判断星级图标是否可点击
    function autoReviewIsStarItemDisabled(item, icon) {
        if (!item || !icon) return true;
        if (item.classList.contains('is-disabled') || icon.classList.contains('is-disabled')) return true;
        if (icon.offsetParent === null) return true;
        const style = getComputedStyle(icon);
        if (!style) return true; // 安全防护：防止获取 style 失败报错
        if (style.pointerEvents === 'none') return true;
        if (style.cursor === 'not-allowed') return true;
        if (style.visibility === 'hidden' || style.display === 'none') return true;
        return false;
    }

    // 选取当前最大可选星级并点击
    function autoReviewClickHighestAvailableStar(dialog) {
        const rateItems = Array.from(dialog.querySelectorAll('.el-rate__item'));
        for (let i = rateItems.length - 1; i >= 0; i--) {
            const item = rateItems[i];
            const icon = item.querySelector('.el-rate__icon') || item;
            if (!autoReviewIsStarItemDisabled(item, icon)) {
                autoReviewClickStarAt(icon, 1);
                return i + 1;
            }
        }
        return 0;
    }

    // ④ 检测是否所有题目已有判断（通过或不通过），若是则跳过通过步骤
    function autoReviewAllJudged() {
        const reviews = Array.from(document.querySelectorAll('.answer--review'));
        if (reviews.length === 0) return false;
        return reviews.every((review) => {
            const passBtn = review.querySelector('.el-button--success');
            const failBtn = review.querySelector('.el-button--danger');
            // 已点通过：passBtn 不含 is-plain；已点不通过：failBtn 不含 is-plain
            const alreadyPassed = passBtn && !passBtn.classList.contains('is-plain');
            const alreadyFailed = failBtn && !failBtn.classList.contains('is-plain');
            return alreadyPassed || alreadyFailed;
        });
    }

    // 一键通过所有合法题目并自动勾选同意规则（不覆盖手动的不通过）
    async function autoReviewPassAllQuestions() {
        let changed = false;

        // 1. 自动选择“同意”单选框（针对注意事项声明等需要勾选同意的题目）
        const pageRadios = Array.from(document.querySelectorAll('.el-radio'));
        const agreeRadio = pageRadios.find(r => {
            const text = r.textContent.trim();
            return text === '同意' || (text.includes('同意') && !text.includes('不同意'));
        });
        if (agreeRadio && !agreeRadio.classList.contains('is-checked')) {
            const input = agreeRadio.querySelector('input') || agreeRadio;
            autoReviewClickEl(input);
            changed = true;
        }

        // 2. 自动勾选“同意”复选框
        const pageCheckboxes = Array.from(document.querySelectorAll('.el-checkbox'));
        const agreeCheckbox = pageCheckboxes.find(c => {
            const text = c.textContent.trim();
            return text.includes('同意') && !text.includes('不同意');
        });
        if (agreeCheckbox && !agreeCheckbox.classList.contains('is-checked')) {
            const input = agreeCheckbox.querySelector('input') || agreeCheckbox;
            autoReviewClickEl(input);
            changed = true;
        }

        if (changed) {
            await autoReviewSleep(100);
        }

        const reviews = Array.from(document.querySelectorAll('.answer--review'));
        let count = 0;
        let skippedFailed = 0;
        reviews.forEach((review) => {
            const passBtn = review.querySelector('.el-button--success');
            const failBtn = review.querySelector('.el-button--danger');
            if (!passBtn || passBtn.disabled) return;

            if (failBtn && !failBtn.classList.contains('is-plain')) {
                skippedFailed++;
                return;
            }

            if (!passBtn.classList.contains('is-plain')) {
                count++;
                return;
            }

            autoReviewClickEl(passBtn);
            count++;
        });
        if (skippedFailed > 0) {
            autoReviewToast('已跳过 ' + skippedFailed + ' 道你手动选择"不通过"的题目，未做修改', true);
        }
        return count;
    }

    function autoReviewGetFinishButton() {
        return Array.from(document.querySelectorAll('button')).find(
            (b) => b.textContent.trim() === '审核完成'
        );
    }

    // 查找包含确认按钮的可见弹窗 (支持 el-dialog 和 el-message-box 并适配 确定/确认)
    function autoReviewGetVisibleReviewDialog() {
        const dialogs = Array.from(document.querySelectorAll('.el-dialog__wrapper, .el-message-box__wrapper'));
        return dialogs.find((d) => {
            const style = getComputedStyle(d);
            if (!style || style.display === 'none') return false;
            const hasConfirmBtn = Array.from(d.querySelectorAll('button')).some((b) => {
                const text = b.textContent.trim();
                return text === '确认' || text === '确定' || b.classList.contains('el-button--primary');
            });
            return hasConfirmBtn;
        });
    }

    function autoReviewIsVisibleClickable(el) {
        if (!el || !el.isConnected || el.disabled) return false;
        const style = getComputedStyle(el);
        return !!style && style.display !== 'none' && style.visibility !== 'hidden' && style.pointerEvents !== 'none';
    }

    function autoReviewGetVisibleSuccessDialog() {
        const dialogs = Array.from(document.querySelectorAll('.el-dialog__wrapper, .el-message-box__wrapper'));
        return dialogs.find((dialog) => {
            const style = getComputedStyle(dialog);
            if (!style || style.display === 'none' || style.visibility === 'hidden') return false;
            const text = (dialog.textContent || '').replace(/\s+/g, '');
            return text.includes('审核成功') || text.includes('已确认订单结果');
        }) || null;
    }

    function autoReviewGetNextOrderButton() {
        const successDialog = autoReviewGetVisibleSuccessDialog();
        if (!successDialog) return null;
        return Array.from(successDialog.querySelectorAll('button')).find(
            (button) => button.textContent.trim() === '审核下一单' && autoReviewIsVisibleClickable(button)
        ) || null;
    }

    function autoReviewWaitForNextOrderButton(timeoutMs = 120000) {
        const immediate = autoReviewGetNextOrderButton();
        if (immediate) {
            immediate.dataset.sjAutoReviewWaitMs = '0';
            return Promise.resolve(immediate);
        }

        return new Promise((resolve, reject) => {
            const startedAt = Date.now();
            let settled = false;
            let observer = null;
            let intervalId = null;
            let timeoutId = null;

            const cleanup = () => {
                if (observer) observer.disconnect();
                if (intervalId) clearInterval(intervalId);
                if (timeoutId) clearTimeout(timeoutId);
            };
            const finish = (button) => {
                if (settled) return;
                settled = true;
                cleanup();
                button.dataset.sjAutoReviewWaitMs = String(Date.now() - startedAt);
                resolve(button);
            };
            const check = () => {
                const button = autoReviewGetNextOrderButton();
                if (button) finish(button);
            };

            observer = new MutationObserver(check);
            observer.observe(document.body, {
                childList: true,
                subtree: true,
                characterData: true,
                attributes: true,
                attributeFilter: ['class', 'style', 'disabled']
            });
            // 轮询作为 Vue/Element UI 某些非 DOM 变更场景的兜底，主要等待仍由弹窗事件驱动。
            intervalId = setInterval(check, 250);
            timeoutId = setTimeout(() => {
                if (settled) return;
                settled = true;
                cleanup();
                reject(new Error('等待“审核成功”弹窗超时'));
            }, timeoutMs);
            check();
        });
    }

    function autoReviewHasVisibleLoadingMask() {
        return Array.from(document.querySelectorAll('.el-loading-mask')).some((mask) => {
            const style = getComputedStyle(mask);
            return !!style && style.display !== 'none' && style.visibility !== 'hidden';
        });
    }

    async function autoReviewWaitForNextOrderReady(initialButton, stableMs = 350, maxWaitMs = 8000) {
        let button = initialButton;
        const startedAt = Date.now();
        let stableSince = null;
        while (Date.now() - startedAt <= maxWaitMs) {
            const currentButton = autoReviewGetNextOrderButton();
            if (currentButton) button = currentButton;
            const ready = autoReviewIsVisibleClickable(button) && !autoReviewHasVisibleLoadingMask();
            if (ready) {
                if (stableSince === null) stableSince = Date.now();
                if (Date.now() - stableSince >= stableMs) {
                    button.dataset.sjAutoReviewStableMs = String(Date.now() - startedAt);
                    return button;
                }
            } else {
                stableSince = null;
            }
            await autoReviewSleep(50);
        }
        throw new Error('“审核下一单”按钮长时间未进入稳定可点击状态');
    }

    // 右上角提示
    function autoReviewToast(msg, isError) {
        if (!document.body) return; // 安全防御：以防 body 尚未挂载
        if (!autoReviewToastEl) {
            autoReviewToastEl = document.createElement('div');
            autoReviewToastEl.style.position = 'fixed';
            autoReviewToastEl.style.top = '80px';
            autoReviewToastEl.style.right = '20px';
            autoReviewToastEl.style.zIndex = 999999;
            autoReviewToastEl.style.padding = '10px 16px';
            autoReviewToastEl.style.borderRadius = '6px';
            autoReviewToastEl.style.fontSize = '14px';
            autoReviewToastEl.style.color = '#fff';
            autoReviewToastEl.style.maxWidth = '320px';
            autoReviewToastEl.style.lineHeight = '1.4';
            autoReviewToastEl.style.boxShadow = '0 2px 8px rgba(0,0,0,.25)';
            document.body.appendChild(autoReviewToastEl);
        }
        autoReviewToastEl.style.background = isError ? '#f56c6c' : '#10b981';
        autoReviewToastEl.textContent = msg;
        autoReviewToastEl.style.display = 'block';
        clearTimeout(autoReviewToastEl._timer);
        autoReviewToastEl._timer = setTimeout(() => {
            autoReviewToastEl.style.display = 'none';
        }, 4000);
    }

    // ① 带执行锁的全流程审核入口（防并发）
    async function autoReviewRunFullFlow() {
        if (autoReviewRunning) {
            autoReviewToast('正在执行中，请稍候...', true);
            return;
        }
        autoReviewRunning = true;
        const btn = document.getElementById('sj-auto-review-btn');

        // ② 按钮切换为加载态
        if (btn) {
            btn.disabled = true;
            btn.textContent = '执行中...';
            btn.innerHTML = '执行中...';
            btn.style.background = '#6b7280';
            btn.style.cursor = 'not-allowed';
            btn.style.boxShadow = 'none';
        }

        try {
            // ④ 检测是否所有题目已有判断，若已全判断则跳过通过步骤直接提交
            if (autoReviewAllJudged()) {
                autoReviewToast('所有题目已有判断，直接提交审核...');
            } else {
                autoReviewToast('开始执行：一键通过所有题目并勾选同意...');
                await autoReviewPassAllQuestions();
                // ③ 去点固定 300ms，弹窗轮询本身已能处理异步等待
            }

            const finishBtn = autoReviewGetFinishButton();
            if (!finishBtn) {
                autoReviewToast('未找到"审核完成"按钮（此单可能已审核过）', true);
                return;
            }
            autoReviewClickEl(finishBtn);

            // 等待确认弹窗（极速轮询，最大等待3秒）
            let dialog = null;
            for (let i = 0; i < 150; i++) { // 150 * 20ms = 3s
                dialog = autoReviewGetVisibleReviewDialog();
                if (dialog) break;
                await autoReviewSleep(20);
            }

            if (!dialog) {
                autoReviewToast('未出现确认弹窗，请检查页面是否有题目未审核完', true);
                return;
            }

            const hasRating = dialog.textContent.includes('打分标准') || dialog.querySelectorAll('.el-rate__item').length > 0;

            if (hasRating) {
                const radios = Array.from(dialog.querySelectorAll('.el-radio'));
                const fullRadio = radios.find((r) => r.textContent.includes('获得赏金的100%'));
                if (fullRadio && !fullRadio.classList.contains('is-checked')) {
                    autoReviewClickEl(fullRadio.querySelector('input') || fullRadio);
                    await autoReviewSleep(20); // 降为 20ms
                }

                const starsSelected = autoReviewClickHighestAvailableStar(dialog);
                if (starsSelected > 0) {
                    await autoReviewSleep(30); // 降为 30ms
                } else {
                    autoReviewToast('未找到可选的星级', true);
                }
            } else {
                autoReviewToast('检测到有题目被判定不通过，将直接确认提交...');
            }

            const confirmBtn = Array.from(dialog.querySelectorAll('button')).find((b) => {
                const text = b.textContent.trim();
                return text === '确认' || text === '确定' || b.classList.contains('el-button--primary');
            });
            if (!confirmBtn) {
                autoReviewToast('未找到确认按钮', true);
                return;
            }
            sjArmPrefetchJump();
            autoReviewClickEl(confirmBtn);

            autoReviewToast('审核已提交，正在等待“审核成功”弹窗...');
            const detectedBtn = await autoReviewWaitForNextOrderButton();
            const waitMs = Number(detectedBtn.dataset.sjAutoReviewWaitMs || 0);

            // 网络拦截未命中时，以网站成功弹窗作为安全兜底。
            if (sjHasReadyPrefetchSlot()) {
                console.log('[AutoReview] 成功弹窗已出现，使用单槽预取订单跳转。');
                sjTriggerPrefetchJump('success-dialog');
                return;
            }

            const nextBtn = await autoReviewWaitForNextOrderReady(detectedBtn);
            const stableMs = Number(nextBtn.dataset.sjAutoReviewStableMs || 0);
            const waitText = waitMs > 0 ? `（弹窗等待 ${(waitMs / 1000).toFixed(1)} 秒）` : '';
            console.log(`[AutoReview] Success dialog detected after ${waitMs}ms; button stabilized for ${stableMs}ms; clicking next order now.`);
            autoReviewToast(`审核成功${waitText}；插件在弹窗出现后 ${(stableMs / 1000).toFixed(1)} 秒已点击下一单，后续为网站加载...`);
            autoReviewClickEl(nextBtn);
        } catch (err) {
            console.error(err);
            const message = err && err.message || String(err);
            if (message.includes('等待“审核成功”弹窗超时')) {
                autoReviewToast('等待审核成功弹窗超过2分钟，插件未重复提交；弹窗出现后请手动点击下一单', true);
            } else {
                autoReviewToast('执行出错: ' + message, true);
            }
        } finally {
            // ① 无论成功失败，均释放锁并还原按钮
            autoReviewRunning = false;
            if (btn) {
                btn.disabled = false;
                btn.textContent = '一键通过审核';
                btn.innerHTML = '<span style="font-size:15px;margin-right:6px;">✓</span>一键通过';
                btn.style.background = 'linear-gradient(135deg,#10b981,#059669)';
                btn.style.cursor = 'pointer';
                btn.style.boxShadow = '0 4px 12px rgba(16, 185, 129, 0.3)';
            }
        }
    }

    // 创建悬浮控制面板
    function autoReviewCreatePanel() {
        if (!document.body || document.getElementById('sj-auto-review-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'sj-auto-review-btn';
        btn.textContent = '一键通过审核';
        btn.title = '快捷键 Alt+A';
        btn.style.position = 'fixed';
        btn.style.top = '50%';
        btn.style.right = '12px';
        btn.style.transform = 'translateY(-50%)';
        btn.style.zIndex = 999998;
        btn.style.padding = '12px 14px';
        btn.style.background = '#10b981';
        btn.style.color = '#fff';
        btn.style.border = 'none';
        btn.style.borderRadius = '8px';
        btn.style.cursor = 'pointer';
        btn.style.fontSize = '14px';
        btn.style.fontWeight = 'bold';
        btn.style.boxShadow = '0 4px 12px rgba(16, 185, 129, 0.3)';
        btn.style.transition = 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)';

        btn.addEventListener('mouseenter', () => {
            btn.style.transform = 'translateY(-50%) scale(1.05)';
            btn.style.background = '#059669';
            btn.style.boxShadow = '0 6px 16px rgba(16, 185, 129, 0.4)';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.transform = 'translateY(-50%) scale(1)';
            btn.style.background = '#10b981';
            btn.style.boxShadow = '0 4px 12px rgba(16, 185, 129, 0.3)';
        });

        // ① 点击直接调用带锁的流程，锁与按钮状态已在 runFullFlow 内统一管理
        btn.addEventListener('click', () => {
            autoReviewRunFullFlow();
        });
        document.body.appendChild(btn);
    }

    let sjRecordingAutoOpenOrderKey = '';
    let sjRecordingAutoOpenRunning = false;

    function sjRecordingGetOrderKey() {
        const match = location.pathname.match(/\/order\/review\/([^/?#]+)/);
        if (match) return match[1];
        const orderLink = document.querySelector('a[href*="/order/review/"]');
        const href = orderLink && (orderLink.getAttribute('href') || orderLink.href || '');
        const linkMatch = href.match(/\/order\/review\/([^/?#]+)/);
        return linkMatch ? linkMatch[1] : location.href;
    }

    function sjRecordingIsVisible(el) {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    }

    function sjRecordingFindFirstCard() {
        const selectors = [
            '.answer-file-icon.sj-icon-mp3-file',
            '.sj-icon-mp3-file',
            '.answer-file-icon[class*="mp3"]',
            '.answer-file [class*="mp3"]',
            '.file-list .answer-file',
            '.answer-file'
        ];
        for (const selector of selectors) {
            const nodes = Array.from(document.querySelectorAll(selector));
            const target = nodes.find(node => sjRecordingIsVisible(node));
            if (target) return target;
        }
        return null;
    }

    function sjRecordingClick(el) {
        if (!el) return false;
        try {
            const rect = el.getBoundingClientRect();
            const options = {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: Math.round(rect.left + rect.width / 2),
                clientY: Math.round(rect.top + rect.height / 2)
            };
            ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach(type => {
                el.dispatchEvent(new MouseEvent(type, options));
            });
            if (typeof el.click === 'function') el.click();
            return true;
        } catch (err) {
            console.warn('[SJ Recording] click failed:', err);
            try {
                el.click();
                return true;
            } catch {
                return false;
            }
        }
    }

    async function sjRecordingOpenFirst(manual) {
        const card = sjRecordingFindFirstCard();
        if (!card) {
            if (manual) autoReviewToast('未找到录音入口，请确认本单有全程录音', true);
            return false;
        }
        const clicked = sjRecordingClick(card);
        if (!clicked && manual) autoReviewToast('打开录音失败，请手动点击录音图标', true);
        return clicked;
    }

    function sjRecordingCloseDialog() {
        const closeBtn = Array.from(document.querySelectorAll(
            '.el-dialog__wrapper .el-dialog__headerbtn, .el-dialog__headerbtn, .el-dialog__close, button[aria-label="Close"], button[aria-label="close"]'
        )).find(btn => sjRecordingIsVisible(btn));
        if (closeBtn) {
            sjRecordingClick(closeBtn);
            return;
        }
        document.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Escape',
            code: 'Escape',
            keyCode: 27,
            which: 27,
            bubbles: true,
            cancelable: true
        }));
    }

    async function sjRecordingAutoOpenForOrder() {
        if (sjRecordingAutoOpenRunning) return;
        if (!location.pathname.startsWith('/order/review')) return;
        if (!document.querySelector('.answer--review')) return;
        if (!sjRecordingFindFirstCard()) return;
        const orderKey = sjRecordingGetOrderKey();
        if (!orderKey || sjRecordingAutoOpenOrderKey === orderKey) return;

        sjRecordingAutoOpenOrderKey = orderKey;
        sjRecordingAutoOpenRunning = true;
        try {
            const opened = await sjRecordingOpenFirst(false);
            if (opened) {
                await autoReviewSleep(1500);
                sjRecordingCloseDialog();
            }
        } catch (err) {
            console.warn('[SJ Recording] auto open failed:', err);
        } finally {
            sjRecordingAutoOpenRunning = false;
        }
    }

    function sjRecordingCreateOpenButton() {
        if (!document.body || document.getElementById('sj-open-recording-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'sj-open-recording-btn';
        btn.textContent = '打开录音';
        btn.title = '快速打开本单第一个录音';
        btn.style.position = 'fixed';
        btn.style.top = 'calc(50% + 54px)';
        btn.style.right = '12px';
        btn.style.zIndex = 999998;
        btn.style.padding = '10px 18px';
        btn.style.background = '#2563eb';
        btn.style.color = '#fff';
        btn.style.border = 'none';
        btn.style.borderRadius = '8px';
        btn.style.cursor = 'pointer';
        btn.style.fontSize = '14px';
        btn.style.fontWeight = 'bold';
        btn.style.boxShadow = '0 4px 12px rgba(37, 99, 235, 0.28)';
        btn.addEventListener('click', () => sjRecordingOpenFirst(true));
        document.body.appendChild(btn);
    }

    // UI sync: replace separate floating buttons with the draggable helper panel used by dist.
    function autoReviewCreatePanel() {
        if (!document.body) return;
        if (document.getElementById('sj-control-panel') && document.getElementById('sj-skip-order-btn')) return;
        document.getElementById('sj-control-panel')?.remove();
        document.getElementById('sj-auto-review-btn')?.remove();
        document.getElementById('sj-open-recording-btn')?.remove();
        document.getElementById('sj-open-audio-btn')?.remove();
        document.getElementById('sj-skip-order-btn')?.remove();

        // ── 注入动画样式 ──
        if (!document.getElementById('sj-panel-styles')) {
            const style = document.createElement('style');
            style.id = 'sj-panel-styles';
            style.textContent = `
                @keyframes sj-pulse {
                    0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.6); }
                    70% { box-shadow: 0 0 0 8px rgba(16, 185, 129, 0); }
                    100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
                }
                .sj-pulse-dot {
                    animation: sj-pulse 2s infinite;
                }
                .sj-panel-btn {
                    position: relative;
                    overflow: hidden;
                }
                .sj-panel-btn::after {
                    content: '';
                    position: absolute;
                    top: 0; left: 0; width: 100%; height: 100%;
                    background: linear-gradient(rgba(255,255,255,0.15), rgba(255,255,255,0));
                    opacity: 0;
                    transition: opacity 0.2s;
                    pointer-events: none;
                }
                .sj-panel-btn:hover::after {
                    opacity: 1;
                }
            `;
            document.head.appendChild(style);
        }

        // ── 面板容器 ──
        const panel = document.createElement('div');
        panel.id = 'sj-control-panel';
        Object.assign(panel.style, {
            position: 'fixed',
            top: '50%',
            right: '70px',
            transform: 'translateY(-50%)',
            zIndex: 999998,
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            padding: '12px',
            width: '142px',
            background: 'linear-gradient(135deg, rgba(24, 28, 41, 0.95) 0%, rgba(14, 17, 24, 0.98) 100%)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '14px',
            boxShadow: '0 20px 40px rgba(0,0,0,0.35), inset 0 1px 1px rgba(255,255,255,0.1)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            userSelect: 'none',
            fontFamily: '-apple-system, "SF Pro Text", "SF Pro Icons", "PingFang SC", "Microsoft YaHei", sans-serif',
            transition: 'border-color 0.3s, box-shadow 0.3s',
        });

        // ── 标题栏 ──
        const header = document.createElement('div');
        Object.assign(header.style, {
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            paddingBottom: '8px',
            marginBottom: '2px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            cursor: 'grab',
        });

        const dot = document.createElement('span');
        dot.className = 'sj-pulse-dot';
        Object.assign(dot.style, {
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: '#10b981',
            flexShrink: '0',
        });

        const titleText = document.createElement('span');
        titleText.textContent = 'AI 审核助手';
        Object.assign(titleText.style, {
            color: '#e2e8f0',
            fontSize: '11px',
            fontWeight: '600',
            letterSpacing: '0.04em',
        });

        header.appendChild(dot);
        header.appendChild(titleText);
        panel.appendChild(header);

        // ── 按钮工厂 ──
        const makePanelBtn = (id, icon, label, bgGradient, glowColor) => {
            const btn = document.createElement('button');
            btn.id = id;
            btn.className = 'sj-panel-btn';
            btn.title = '';
            Object.assign(btn.style, {
                width: '100%',
                height: '36px',
                border: 'none',
                borderRadius: '8px',
                color: '#ffffff',
                fontSize: '13px',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                background: bgGradient,
                boxShadow: `0 4px 12px ${glowColor}`,
                transition: 'all 0.15s cubic-bezier(0.4, 0, 0.2, 1)',
                letterSpacing: '0.02em',
                outline: 'none',
            });

            const iconEl = document.createElement('span');
            iconEl.textContent = icon;
            Object.assign(iconEl.style, {
                fontSize: '13px',
                lineHeight: '1',
                display: 'inline-flex',
                alignItems: 'center',
            });

            const labelEl = document.createElement('span');
            labelEl.textContent = label;

            btn.appendChild(iconEl);
            btn.appendChild(labelEl);

            btn.addEventListener('mouseenter', () => {
                if (btn.disabled) return;
                btn.style.transform = 'translateY(-2px)';
                btn.style.boxShadow = `0 6px 18px ${glowColor}`;
                btn.style.filter = 'brightness(1.08)';
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.transform = 'translateY(0)';
                btn.style.boxShadow = `0 4px 12px ${glowColor}`;
                btn.style.filter = 'brightness(1)';
            });
            btn.addEventListener('mousedown', () => {
                if (btn.disabled) return;
                btn.style.transform = 'translateY(1px)';
                btn.style.filter = 'brightness(0.95)';
            });
            btn.addEventListener('mouseup', () => {
                if (btn.disabled) return;
                btn.style.transform = 'translateY(-2px)';
                btn.style.filter = 'brightness(1.08)';
            });

            panel.appendChild(btn);
            return btn;
        };

        const passBtn = makePanelBtn(
            'sj-auto-review-btn', '⚡', '一键通过',
            'linear-gradient(135deg, #10b981 0%, #059669 100%)',
            'rgba(16, 185, 129, 0.3)'
        );
        passBtn.title = '快捷键 Alt+A';
        passBtn.addEventListener('click', () => autoReviewRunFullFlow());

        const audioBtn = makePanelBtn(
            'sj-open-recording-btn', '🎧', '打开录音',
            'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
            'rgba(59, 130, 246, 0.3)'
        );
        audioBtn.title = '快速打开本单第一个录音';
        audioBtn.addEventListener('click', () => sjRecordingOpenFirst(true));

        // ── 独立跳过按钮：固定在主面板右侧 ──
        const skipBtn = document.createElement('button');
        skipBtn.id = 'sj-skip-order-btn';
        skipBtn.type = 'button';
        skipBtn.textContent = '⏭ 跳过此单';
        skipBtn.title = '取消占有当前订单并进入已缓存的下一单';
        Object.assign(skipBtn.style, {
            position: 'fixed',
            top: '50%',
            right: '20px',
            transform: 'translateY(-50%)',
            zIndex: 999998,
            width: '40px',
            minHeight: '104px',
            padding: '10px 8px',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '12px',
            color: '#ffffff',
            background: 'linear-gradient(160deg, #f59e0b 0%, #b45309 100%)',
            boxShadow: '0 8px 24px rgba(245,158,11,0.34), inset 0 1px 1px rgba(255,255,255,0.18)',
            cursor: 'pointer',
            writingMode: 'vertical-rl',
            textOrientation: 'mixed',
            letterSpacing: '2px',
            fontSize: '13px',
            fontWeight: '700',
            fontFamily: '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
            transition: 'transform 0.15s ease, filter 0.15s ease, box-shadow 0.15s ease',
        });
        skipBtn.addEventListener('mouseenter', () => {
            if (skipBtn.disabled) return;
            skipBtn.style.filter = 'brightness(1.1)';
            skipBtn.style.boxShadow = '0 12px 28px rgba(245,158,11,0.48), inset 0 1px 1px rgba(255,255,255,0.18)';
        });
        skipBtn.addEventListener('mouseleave', () => {
            skipBtn.style.filter = 'brightness(1)';
            skipBtn.style.boxShadow = '0 8px 24px rgba(245,158,11,0.34), inset 0 1px 1px rgba(255,255,255,0.18)';
        });
        skipBtn.addEventListener('click', () => sjSkipCurrentOrder(skipBtn));

        const syncSkipButtonPosition = () => {
            const panelRect = panel.getBoundingClientRect();
            const gap = 8;
            const skipWidth = skipBtn.offsetWidth || 40;
            const maxPanelLeft = Math.max(0, window.innerWidth - panelRect.width - skipWidth - gap);
            if (panelRect.left > maxPanelLeft) {
                panel.style.right = 'auto';
                panel.style.transform = 'none';
                panel.style.left = maxPanelLeft + 'px';
            }
            const updatedRect = panel.getBoundingClientRect();
            skipBtn.style.right = 'auto';
            skipBtn.style.bottom = 'auto';
            skipBtn.style.transform = 'none';
            skipBtn.style.left = Math.min(window.innerWidth - skipWidth, updatedRect.right + gap) + 'px';
            skipBtn.style.top = updatedRect.top + 'px';
            skipBtn.style.height = updatedRect.height + 'px';
        };

        // ── 拖拽逻辑 ──
        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let initialLeft = 0;
        let initialTop = 0;

        panel.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            if (e.target.closest('button')) return;
            isDragging = false;
            startX = e.clientX;
            startY = e.clientY;
            const rect = panel.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;
            header.style.cursor = 'grabbing';
            document.addEventListener('mousemove', onPanelMouseMove);
            document.addEventListener('mouseup', onPanelMouseUp);
            e.preventDefault();
        });

        const onPanelMouseMove = (e) => {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            if (!isDragging && Math.sqrt(dx * dx + dy * dy) > 5) isDragging = true;
            if (!isDragging) return;
            const rect = panel.getBoundingClientRect();
            const skipSpace = (skipBtn.offsetWidth || 40) + 8;
            const newLeft = Math.max(0, Math.min(initialLeft + dx, window.innerWidth - rect.width - skipSpace));
            const newTop = Math.max(0, Math.min(initialTop + dy, window.innerHeight - rect.height));
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
            panel.style.transform = 'none';
            panel.style.left = newLeft + 'px';
            panel.style.top = newTop + 'px';
            syncSkipButtonPosition();
        };

        const onPanelMouseUp = () => {
            document.removeEventListener('mousemove', onPanelMouseMove);
            document.removeEventListener('mouseup', onPanelMouseUp);
            header.style.cursor = 'grab';
            if (isDragging) {
                const rect = panel.getBoundingClientRect();
                localStorage.setItem('sj_control_panel_x', Math.round(rect.left));
                localStorage.setItem('sj_control_panel_y', Math.round(rect.top));
            }
        };

        const savedX = localStorage.getItem('sj_control_panel_x');
        const savedY = localStorage.getItem('sj_control_panel_y');
        if (savedX && savedY) {
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
            panel.style.transform = 'none';
            panel.style.left = savedX + 'px';
            panel.style.top = savedY + 'px';
        }

        document.body.appendChild(panel);
        document.body.appendChild(skipBtn);
        requestAnimationFrame(syncSkipButtonPosition);
    }

    function sjRecordingCreateOpenButton() {
        autoReviewCreatePanel();
    }

    // ------------------------------------------------------------
    // 单槽预取状态机 (v3.9.2)
    // 调用网站“开始审单”背后的同一请求，任何时刻最多保存一个待审核订单。
    // ------------------------------------------------------------
    const SJ_PREFETCH_SLOT_KEY = 'sj_prefetch_single_slot_v2';
    const SJ_PREFETCH_LOCK_KEY = 'sj_prefetch_single_lock_v2';
    const SJ_PREFETCH_ATTEMPT_PREFIX = 'sj_prefetch_attempt_v2_';
    const SJ_PREFETCH_SLOT_TTL_MS = 25 * 60 * 1000;
    const SJ_PREFETCH_ATTEMPT_TTL_MS = 10 * 60 * 1000;
    const SJ_PREFETCH_ARM_TTL_MS = 2 * 60 * 1000;
    let sjPrefetchV2InFlight = false;
    let sjPrefetchJumping = false;
    let sjAuditJumpArm = null;

    function sjGetCurrentOrderId() {
        const match = location.pathname.match(/\/order\/review\/(\d+)/);
        return match ? match[1] : null;
    }

    function sjReadPrefetchSlot() {
        const raw = localStorage.getItem(SJ_PREFETCH_SLOT_KEY);
        if (!raw) return null;
        try {
            const slot = JSON.parse(raw);
            const nextOrderId = String(slot && slot.nextOrderId || '');
            const createdAt = Number(slot && slot.createdAt || 0);
            if (!/^\d+$/.test(nextOrderId) || !createdAt || Date.now() - createdAt > SJ_PREFETCH_SLOT_TTL_MS) {
                localStorage.removeItem(SJ_PREFETCH_SLOT_KEY);
                return null;
            }
            return { ...slot, nextOrderId, createdAt };
        } catch (error) {
            localStorage.removeItem(SJ_PREFETCH_SLOT_KEY);
            return null;
        }
    }

    function sjWritePrefetchSlot(slot) {
        localStorage.setItem(SJ_PREFETCH_SLOT_KEY, JSON.stringify(slot));
    }

    function sjHasReadyPrefetchSlot() {
        const slot = sjReadPrefetchSlot();
        return Boolean(slot && slot.state === 'ready' && slot.nextOrderId !== sjGetCurrentOrderId());
    }

    function sjFinalizePrefetchSlotForCurrentOrder(currentOrderId) {
        const slot = sjReadPrefetchSlot();
        if (!slot) return null;
        if (slot.nextOrderId === String(currentOrderId) && slot.state === 'consuming') {
            localStorage.removeItem(SJ_PREFETCH_SLOT_KEY);
            sjPrefetchJumping = false;
            console.log(`[Prefetch] 已进入预取订单 ${currentOrderId}，单槽已清空。`);
            return null;
        }
        return slot;
    }

    function sjFindVueStore() {
        const candidates = [
            document.querySelector('#app'),
            document.querySelector('.answer--review'),
            document.querySelector('.order-review'),
            document.querySelector('.el-table')
        ].filter(Boolean);
        for (const element of candidates) {
            let vm = element.__vue__ || null;
            while (vm) {
                if (vm.$store && vm.$store.state) return vm.$store;
                vm = vm.$parent || null;
            }
        }
        return null;
    }

    function sjGetActiveProjectId() {
        try {
            const store = sjFindVueStore();
            const state = store && store.state;
            const candidates = [
                state && state.orderReview && state.orderReview.orderDetail,
                state && state.orderReview && state.orderReview.detail,
                state && state.order && state.order.orderDetail
            ].filter(Boolean);
            for (const detail of candidates) {
                const projectId = detail.projectid || detail.projectId;
                if (projectId) return projectId;
            }
        } catch (error) {
            console.error('[Prefetch] 提取 projectid 失败:', error);
        }
        return null;
    }

    function sjExtractPrefetchedOrderId(response) {
        const data = response && response.data;
        const nested = data && data.data;
        const value = data && (data.orderid || data.orderId) ||
            nested && (nested.orderid || nested.orderId) ||
            response && (response.orderid || response.orderId);
        const orderId = String(value || '');
        return /^\d+$/.test(orderId) ? orderId : null;
    }

    function sjAcquirePrefetchLock() {
        const now = Date.now();
        try {
            const existing = JSON.parse(localStorage.getItem(SJ_PREFETCH_LOCK_KEY) || 'null');
            if (existing && Number(existing.expiresAt) > now) return null;
        } catch (error) {}
        const token = `${now}_${Math.random().toString(36).slice(2)}`;
        localStorage.setItem(SJ_PREFETCH_LOCK_KEY, JSON.stringify({ token, expiresAt: now + 30000 }));
        try {
            const saved = JSON.parse(localStorage.getItem(SJ_PREFETCH_LOCK_KEY) || 'null');
            return saved && saved.token === token ? token : null;
        } catch (error) {
            return null;
        }
    }

    function sjReleasePrefetchLock(token) {
        try {
            const saved = JSON.parse(localStorage.getItem(SJ_PREFETCH_LOCK_KEY) || 'null');
            if (saved && saved.token === token) localStorage.removeItem(SJ_PREFETCH_LOCK_KEY);
        } catch (error) {}
    }

    function sjPrefetchNextOrder(currentOrderId, projectId) {
        currentOrderId = String(currentOrderId || '');
        if (!/^\d+$/.test(currentOrderId) || !projectId) return Promise.resolve(false);
        if (sjFinalizePrefetchSlotForCurrentOrder(currentOrderId)) return Promise.resolve(false);
        if (sjPrefetchV2InFlight) return Promise.resolve(false);

        const attemptKey = SJ_PREFETCH_ATTEMPT_PREFIX + currentOrderId;
        const previousAttempt = Number(sessionStorage.getItem(attemptKey) || 0);
        if (previousAttempt && Date.now() - previousAttempt < SJ_PREFETCH_ATTEMPT_TTL_MS) {
            return Promise.resolve(false);
        }

        const lockToken = sjAcquirePrefetchLock();
        if (!lockToken) return Promise.resolve(false);
        if (sjReadPrefetchSlot()) {
            sjReleasePrefetchLock(lockToken);
            return Promise.resolve(false);
        }

        const req = typeof unsafeWindow !== 'undefined' && unsafeWindow.request || window.request;
        if (!req || typeof req.common !== 'function') {
            sjReleasePrefetchLock(lockToken);
            return Promise.resolve(false);
        }

        sjPrefetchV2InFlight = true;
        sessionStorage.setItem(attemptKey, String(Date.now()));
        console.log(`[Prefetch] 单槽为空，为订单 ${currentOrderId} 预取一单。`);

        return Promise.resolve(req.common('createAuditTask', { projectid: Number(projectId) }))
            .then((response) => {
                const nextOrderId = sjExtractPrefetchedOrderId(response);
                if (!nextOrderId || nextOrderId === currentOrderId) {
                    console.warn('[Prefetch] 开始审单请求未返回有效的新订单号:', response);
                    return false;
                }
                if (sjReadPrefetchSlot()) return false;
                sjWritePrefetchSlot({
                    state: 'ready',
                    nextOrderId,
                    projectId: String(projectId),
                    createdAt: Date.now()
                });
                console.log(`[Prefetch] 单槽已保存订单 ${nextOrderId}。`);
                return true;
            })
            .catch((error) => {
                // 本订单不自动重试，避免响应丢失时重复领取。
                console.error('[Prefetch] 预取失败，本订单将回退官方下一单流程:', error);
                return false;
            })
            .finally(() => {
                sjPrefetchV2InFlight = false;
                sjReleasePrefetchLock(lockToken);
            });
    }

    function sjArmPrefetchJump() {
        const currentOrderId = sjGetCurrentOrderId();
        if (!currentOrderId || !sjHasReadyPrefetchSlot()) {
            sjAuditJumpArm = null;
            return false;
        }
        sjAuditJumpArm = { currentOrderId, armedAt: Date.now() };
        return true;
    }

    function sjAuditResponseIsSuccessful(status, responseText) {
        if (Number(status) < 200 || Number(status) >= 300) return false;
        const text = typeof responseText === 'string' ? responseText.trim() : '';
        if (!text) return true;
        try {
            const data = JSON.parse(text);
            if (data && data.success === false) return false;
            if (data && data.code !== undefined && ![0, 200].includes(Number(data.code))) return false;
            if (data && data.status !== undefined && ![0, 200].includes(Number(data.status))) return false;
        } catch (error) {
            // 有些提交接口成功时返回纯文本；HTTP 2xx 且已由确认按钮授权即可继续。
        }
        return true;
    }

    function sjHandleAuditSubmitResponse(meta) {
        const arm = sjAuditJumpArm;
        if (!arm || Date.now() - arm.armedAt > SJ_PREFETCH_ARM_TTL_MS) {
            sjAuditJumpArm = null;
            return false;
        }
        if (sjGetCurrentOrderId() !== arm.currentOrderId) return false;
        if (!sjAuditResponseIsSuccessful(meta && meta.status, meta && meta.responseText)) return false;
        sjAuditJumpArm = null;
        return sjTriggerPrefetchJump('submit-response');
    }

    function sjTriggerPrefetchJump(reason = 'fallback') {
        if (sjPrefetchJumping) return false;
        const currentOrderId = sjGetCurrentOrderId();
        const slot = sjReadPrefetchSlot();
        if (!currentOrderId || !slot || slot.state !== 'ready' || slot.nextOrderId === currentOrderId) return false;

        sjPrefetchJumping = true;
        sjWritePrefetchSlot({ ...slot, state: 'consuming', fromOrderId: currentOrderId, consumedAt: Date.now() });
        console.log(`[Prefetch] ${reason}: ${currentOrderId} -> ${slot.nextOrderId}`);
        autoReviewToast(`审核提交成功，正在进入已预取订单 ${slot.nextOrderId}...`);

        const restoreTimer = setTimeout(() => {
            if (sjGetCurrentOrderId() !== currentOrderId) return;
            const pending = sjReadPrefetchSlot();
            if (pending && pending.state === 'consuming' && pending.nextOrderId === slot.nextOrderId) {
                sjWritePrefetchSlot({ ...pending, state: 'ready' });
            }
            sjPrefetchJumping = false;
        }, 8000);

        try {
            location.assign('/order/review/' + slot.nextOrderId);
            return true;
        } catch (error) {
            clearTimeout(restoreTimer);
            sjWritePrefetchSlot({ ...slot, state: 'ready' });
            sjPrefetchJumping = false;
            console.error('[Prefetch] 跳转失败，已恢复单槽:', error);
            return false;
        }
    }

    // ------------------------------------------------------------
    // 跳过当前订单：先确认取消占有成功，再消费单槽或领取下一单。
    // ------------------------------------------------------------
    const SJ_SKIP_PENDING_KEY = 'sj_skip_pending_v1';
    const SJ_SKIP_PENDING_TTL_MS = 2 * 60 * 1000;
    let sjSkipRunning = false;

    function sjReadSkipPending() {
        const raw = localStorage.getItem(SJ_SKIP_PENDING_KEY);
        if (!raw) return null;
        try {
            const pending = JSON.parse(raw);
            if (!pending || !pending.createdAt || Date.now() - Number(pending.createdAt) > SJ_SKIP_PENDING_TTL_MS) {
                localStorage.removeItem(SJ_SKIP_PENDING_KEY);
                return null;
            }
            return pending;
        } catch (error) {
            localStorage.removeItem(SJ_SKIP_PENDING_KEY);
            return null;
        }
    }

    function sjWriteSkipPending(pending) {
        localStorage.setItem(SJ_SKIP_PENDING_KEY, JSON.stringify(pending));
    }

    function sjSkipIsVisible(element) {
        if (!element || !element.isConnected) return false;
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }

    function sjFindCancelOccupyButton() {
        // 该元素位于折叠的工单信息区域内；即使不可见，Vue 的点击处理仍然有效。
        const nativeCancel = document.querySelector('i.el-alert__closebtn.is-customed');
        if (nativeCancel && nativeCancel.textContent.replace(/\s+/g, '').includes('取消占有')) {
            return nativeCancel;
        }
        return Array.from(document.querySelectorAll('button,.el-button,[role="button"],i')).find((element) => {
            if (element.id === 'sj-skip-order-btn') return false;
            return element.textContent.replace(/\s+/g, '').includes('取消占有');
        }) || null;
    }

    async function sjConfirmCancelOccupyDialog(timeoutMs = 800) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const wrappers = Array.from(document.querySelectorAll('.el-message-box__wrapper,.el-dialog__wrapper'));
            const dialog = wrappers.find((element) => {
                const text = element.textContent.replace(/\s+/g, '');
                return sjSkipIsVisible(element) && (text.includes('取消占有') || text.includes('确认取消'));
            });
            if (dialog) {
                const confirmBtn = Array.from(dialog.querySelectorAll('button')).find((button) => {
                    const text = button.textContent.trim();
                    return text === '确定' || text === '确认' || button.classList.contains('el-button--primary');
                });
                if (confirmBtn) {
                    autoReviewClickEl(confirmBtn);
                    return true;
                }
            }
            await autoReviewSleep(50);
        }
        return false;
    }

    async function sjWaitForCancelOccupySuccess(currentOrderId, cancelButton, timeoutMs = 15000) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const routeOrderId = sjGetCurrentOrderId();
            if (routeOrderId !== currentOrderId) return true;
            if (!cancelButton.isConnected) return true;

            const successMessage = Array.from(document.querySelectorAll(
                '.el-message--success,.el-notification.success,.el-notification--success'
            )).find((element) => {
                const text = element.textContent.replace(/\s+/g, '');
                return sjSkipIsVisible(element) && (text.includes('取消') || text.includes('释放'));
            });
            if (successMessage) return true;
            await autoReviewSleep(100);
        }
        throw new Error('等待网站确认取消占有超时');
    }

    function sjConsumeReadySlotForSkip(fromOrderId) {
        const slot = sjReadPrefetchSlot();
        if (!slot || slot.state !== 'ready' || slot.nextOrderId === String(fromOrderId)) return false;
        sjWritePrefetchSlot({
            ...slot,
            state: 'consuming',
            fromOrderId: String(fromOrderId),
            consumedAt: Date.now()
        });
        localStorage.removeItem(SJ_SKIP_PENDING_KEY);
        autoReviewToast(`当前订单已释放，正在进入订单 ${slot.nextOrderId}...`);
        location.assign('/order/review/' + slot.nextOrderId);
        return true;
    }

    async function sjHandlePendingSkipNavigation() {
        const pending = sjReadSkipPending();
        if (!pending) return false;

        const currentOrderId = sjGetCurrentOrderId();
        if (pending.state === 'releasing' && currentOrderId === String(pending.currentOrderId)) {
            return false;
        }
        if (currentOrderId && currentOrderId !== String(pending.currentOrderId)) {
            localStorage.removeItem(SJ_SKIP_PENDING_KEY);
            return true;
        }

        if (!sjConsumeReadySlotForSkip(pending.currentOrderId)) {
            localStorage.removeItem(SJ_SKIP_PENDING_KEY);
            autoReviewToast('当前订单已释放，但缓存的下一单不存在，请手动进入下一单。', true);
            return false;
        }
        return true;
    }

    async function sjSkipCurrentOrder(button) {
        if (sjSkipRunning || autoReviewRunning) return;
        const currentOrderId = sjGetCurrentOrderId();
        const cancelButton = sjFindCancelOccupyButton();
        if (!currentOrderId || !cancelButton) {
            autoReviewToast('未找到网站的“取消占有”按钮，无法安全跳过。', true);
            return;
        }

        const existingSlot = sjReadPrefetchSlot();
        if (!existingSlot || existingSlot.state !== 'ready') {
            autoReviewToast('下一单尚未缓存完成，请稍等后再跳过。', true);
            return;
        }


        sjSkipRunning = true;
        if (button) {
            button.disabled = true;
            button.textContent = '… 正在释放';
        }
        const pending = {
            state: 'releasing',
            currentOrderId,
            createdAt: Date.now()
        };
        sjWriteSkipPending(pending);

        try {
            autoReviewToast('正在取消占有当前订单...');
            autoReviewClickEl(cancelButton);
            await sjConfirmCancelOccupyDialog();
            await sjWaitForCancelOccupySuccess(currentOrderId, cancelButton);
            sjWriteSkipPending({ ...pending, state: 'acquiring' });
            await sjHandlePendingSkipNavigation();
        } catch (error) {
            console.error('[Skip] 跳过失败:', error);
            localStorage.removeItem(SJ_SKIP_PENDING_KEY);
            autoReviewToast('取消占有未确认成功，已停止跳转：' + error.message, true);
        } finally {
            sjSkipRunning = false;
            if (button && button.isConnected) {
                button.disabled = false;
                button.textContent = '⏭ 跳过此单';
            }
        }
    }


// ===== stt.js =====
    // ==========================================
    // AI 语音重识别字幕模块 (SenseVoice STT)
    // ==========================================
    // AI 语音重识别字幕模块 (SenseVoice STT)
    // ==========================================
    // AI 语音重识别字幕模块 (SenseVoice STT)
    // ==========================================
    const STT_API_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
    const STT_MODEL   = 'whisper-large-v3';
    const STT_KEY_LS  = 'sj_groq_api_key';
    const SF_STT_API_URL = 'https://api.siliconflow.cn/v1/audio/transcriptions';
    const SF_STT_MODEL = 'FunAudioLLM/SenseVoiceSmall';
    const SF_KEY_LS = 'sj_siliconflow_api_key';
    const STT_CACHE_PREFIX = 'stt_cache_v2_';
    const STT_AI_ENABLED_LS = 'sj_stt_ai_enabled';
    const STT_SHORT_AUDIO_MAX_SECONDS = 360;
    const STT_SHORT_AUDIO_MAX_BYTES = 8 * 1024 * 1024;

    function sttGetGroqKey() { return localStorage.getItem(STT_KEY_LS) || ''; }
    function sttSaveGroqKey(k) { localStorage.setItem(STT_KEY_LS, k.trim()); }
    function sttGetSiliconFlowKey() { return localStorage.getItem(SF_KEY_LS) || ''; }
    function sttSaveSiliconFlowKey(k) { localStorage.setItem(SF_KEY_LS, k.trim()); }
    function sttGetKey() { return sttGetGroqKey(); }
    function sttSaveKey(k) { sttSaveGroqKey(k); }
    function sttIsAiEnabled() { return localStorage.getItem(STT_AI_ENABLED_LS) === '1'; }
    function sttSetAiEnabled(enabled) { localStorage.setItem(STT_AI_ENABLED_LS, enabled ? '1' : '0'); }

    function sttHasAnyProviderKey() {
        return !!(sttGetSiliconFlowKey() || sttGetGroqKey());
    }

    function sttParseDurationFromSrc(src) {
        const m = String(src || '').match(/(?:^|[_-])dur(\d+)(?:[_\-.]|$)/i);
        return m ? Number(m[1]) : 0;
    }

    function sttChooseProvider(audio, blob, src) {
        const providers = sttChooseProviders(audio, blob, src);
        return providers[0] || null;
    }

    // 从 Blob 中获取真实音频时长（通过虚拟 Audio 元素，不产生额外网络开销，支持本地缓存）
    function sttGetAudioDurationFromBlob(blob) {
        return new Promise((resolve) => {
            try {
                const url = URL.createObjectURL(blob);
                const audio = new Audio();
                audio.src = url;
                
                // 设置超时防止在非音频文件上挂起
                const timer = setTimeout(() => {
                    URL.revokeObjectURL(url);
                    resolve(0);
                }, 2000);

                audio.addEventListener('loadedmetadata', () => {
                    clearTimeout(timer);
                    const dur = audio.duration;
                    URL.revokeObjectURL(url);
                    resolve(Number.isFinite(dur) ? dur : 0);
                });

                audio.addEventListener('error', () => {
                    clearTimeout(timer);
                    URL.revokeObjectURL(url);
                    resolve(0);
                });
            } catch (err) {
                console.warn('[STT] Failed to get duration from blob:', err);
                resolve(0);
            }
        });
    }

    function sttChooseProviders(audio, blob, src) {
        const duration = Number(audio && audio.duration) || sttParseDurationFromSrc(src);
        const sfKey = sttGetSiliconFlowKey();
        const groqKey = sttGetGroqKey();
        const sf = sfKey ? { id: 'siliconflow', label: 'SiliconFlow', url: SF_STT_API_URL, model: SF_STT_MODEL, key: sfKey } : null;
        const groq = groqKey ? { id: 'groq', label: 'Groq', url: STT_API_URL, model: STT_MODEL, key: groqKey } : null;

        // 如果我们有明确的 duration（从 audio 元素或文件名解析得到）
        if (duration > 0) {
            if (duration <= STT_SHORT_AUDIO_MAX_SECONDS) {
                // 少于6分钟：直接且优先使用硅基流动，Groq 作为备选
                return [sf, groq].filter(Boolean);
            } else {
                // 大于6分钟：直接且优先使用 Groq，硅基流动作为备选
                return [groq, sf].filter(Boolean);
            }
        }

        // 如果实在没有 duration，退而求其次用 blob 大小判断（修改阈值为 2.5MB，对应约 6 分钟低码率音频）
        const isShort = !!blob && blob.size > 0 && blob.size <= 2.5 * 1024 * 1024;
        if (isShort) {
            return [sf, groq].filter(Boolean);
        } else {
            return [groq, sf].filter(Boolean);
        }
    }

    function sttBuildFormData(provider, blob) {
        const fd = new FormData();
        fd.append('file', blob, 'audio.mp3');
        fd.append('model', provider.model);

        if (provider.id === 'groq') {
            fd.append('response_format', 'verbose_json');
            fd.append('language', 'zh');
            fd.append('temperature', '0');
            fd.append('prompt', '这是门店审核录音，只转写真实对话。核心词：脉动、卖动、麦动、1L、一升、大瓶、电解质、库存、仓库、整箱、几箱、几件、现货、还有货、多少钱、价格、元、块。请保留中文标点，并按说话停顿分句。不要编造新闻、广告、订阅、故事、外语或无关内容；听不清就留空。');
        }
        return fd;
    }

    function sttTranscribeBlob(provider, blob) {
        const fd = sttBuildFormData(provider, blob);
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: provider.url,
                headers: { 'Authorization': 'Bearer ' + provider.key },
                data: fd,
                onload: r => {
                    if (r.status === 200) {
                        resolve(r.responseText);
                    } else {
                        console.error(`[STT] ${provider.label} raw error:`, r.responseText);
                        let errMsg = r.status;
                        try {
                            const j = JSON.parse(r.responseText);
                            errMsg = (j.error && j.error.message) || j.message || errMsg;
                        } catch {}
                        reject(new Error(provider.label + ' API ' + errMsg));
                    }
                },
                onerror: () => reject(new Error(provider.label + ' 网络错误')),
                ontimeout: () => reject(new Error(provider.label + ' 请求超时'))
            });
        });
    }

    async function sttTranscribeWithFallback(providers, blob, onProviderStart) {
        let lastError = null;
        for (let i = 0; i < providers.length; i++) {
            const provider = providers[i];
            try {
                if (onProviderStart) onProviderStart(provider);
                const resultText = await sttTranscribeBlob(provider, blob);
                
                // 如果是最后一个 provider，直接返回，不做信号判定
                if (i === providers.length - 1) {
                    return resultText;
                }

                // 否则，解析结果并检查是否有有效业务信号。如果无信号且还有下一个 provider，我们继续 fallback。
                const segs = parseApiResponse(resultText, 0);
                if (sttHasUsefulBusinessSignal(segs)) {
                    return resultText;
                } else {
                    console.warn(`[STT] ${provider.label} 识别成功但未检测到有效业务信号，将尝试 fallback 到下一个服务...`);
                }
            } catch (e) {
                lastError = e;
                console.warn('[STT] Provider failed, trying next if available:', provider.label, e.message);
            }
        }
        throw lastError || new Error('没有可用的语音识别服务');
    }

    // 读取 / 写入 sessionStorage 缓存（同一会话内不重复调用 API）
    function sttReadCache(src) {
        try { return JSON.parse(sessionStorage.getItem(STT_CACHE_PREFIX + src)); } catch { return null; }
    }
    function sttWriteCache(src, segs) {
        try { sessionStorage.setItem(STT_CACHE_PREFIX + src, JSON.stringify(segs)); } catch {}
    }

    // 获取顶层状态栏
    function sttGetStatusBar(dialogBody) {
        const lyricEl = document.querySelector('.audio-player-lyric');
        // 直接以歌词面板 lyricEl 作为挂载容器，如果不存在则退回到 dialogBody
        // 避免给整个播放器大容器设置 position: relative，从而破坏左侧音频列表的绝对定位和点击层级
        const playerContainer = lyricEl || dialogBody;

        let p = document.getElementById('sj-stt-status');
        if (!p) {
            p = document.createElement('div');
            p.id = 'sj-stt-status';

            // 确保挂载容器为 relative 定位，便于绝对定位
            if (playerContainer && playerContainer !== dialogBody) {
                playerContainer.style.setProperty('position', 'relative', 'important');
            }

            p.style.cssText = [
                'position:absolute',
                'top:12px',
                'right:12px',
                'z-index:2000',
                'background:rgba(9, 13, 22, 0.85)',
                'backdrop-filter:blur(8px)',
                'border:1px solid rgba(255, 255, 255, 0.1)',
                'border-radius:6px',
                'padding:6px 12px',
                'font-family:system-ui,-apple-system,sans-serif',
                'font-size:11px',
                'display:flex',
                'align-items:center',
                'gap:8px',
                'color:#cbd5e1',
                'box-shadow:0 4px 12px rgba(0,0,0,0.3)',
                'pointer-events:auto'
            ].join(';');

            if (playerContainer) {
                playerContainer.appendChild(p);
            } else {
                dialogBody.insertBefore(p, dialogBody.firstChild);
            }
        }
        return p;
    }

    function sttRenderLoading(bar, provider) {
        const providerLabel = provider && provider.label ? provider.label : 'AI';
        bar.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;color:#8b949e;">
                <div style="width:12px;height:12px;border:2px solid #388bfd;border-top-color:transparent;border-radius:50%;animation:sj-stt-spin 0.8s linear infinite;"></div>
                <style>@keyframes sj-stt-spin{to{transform:rotate(360deg)}}</style>
                🤖 ${providerLabel} 正在识别语音...
            </div>`;
    }

    function sttRenderError(bar, msg) {
        bar.innerHTML = `<div style="color:#f85149;">❌ AI识别失败：${msg}</div>`;
    }

    function sttRenderAiToggleButton() {
        const enabled = sttIsAiEnabled();
        return `<button id="sj-stt-ai-toggle" title="${enabled ? '关闭后不再自动调用硅基/Groq' : '开启后允许调用硅基/Groq'}" style="background:${enabled ? '#238636' : '#30363d'};color:#fff;border:none;border-radius:4px;padding:4px 8px;cursor:pointer;font-size:11px;white-space:nowrap;">${enabled ? 'AI开' : 'AI关'}</button>`;
    }

    function sttBindAiToggle(bar, audio, dialogBody, rerunAfterEnable = false) {
        const btn = bar.querySelector('#sj-stt-ai-toggle');
        if (!btn) return;
        btn.addEventListener('click', () => {
            const next = !sttIsAiEnabled();
            sttSetAiEnabled(next);
            if (next) {
                sttProcess(audio, dialogBody, true);
            } else {
                if (audio && audio.src && sttTryUseNativeSubtitlesFallback(audio, dialogBody, bar, 'ai-disabled-toggle')) {
                    return;
                }
                sttRenderAiDisabled(bar, audio, dialogBody);
            }
        });
    }

    function sttRenderAiDisabled(bar, audio, dialogBody) {
        bar.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;width:100%;color:#8b949e;">
                <span style="white-space:nowrap;">AI识别关闭，当前只使用原生字幕/缓存</span>
                ${sttRenderAiToggleButton()}
                <button id="sj-stt-ai-enable-now" style="background:#238636;color:#fff;border:none;border-radius:4px;padding:4px 10px;cursor:pointer;font-size:12px;white-space:nowrap;">开启并识别</button>
            </div>`;
        
        if (audio && audio.src) {
            sttCurrentOrderTranscripts[audio.src] = [];
            sttUpdateContextualTips();
        }

        sttBindAiToggle(bar, audio, dialogBody, true);
        const enableBtn = bar.querySelector('#sj-stt-ai-enable-now');
        if (enableBtn) {
            enableBtn.addEventListener('click', () => {
                sttSetAiEnabled(true);
                sttProcess(audio, dialogBody);
            });
        }
    }

    function sttRenderKeyPrompt(bar, audio, dialogBody) {
        bar.innerHTML = `
            <div style="display:grid;grid-template-columns:auto minmax(110px,1fr) auto minmax(110px,1fr) auto;align-items:center;gap:6px;width:100%;">
                <span style="color:#d29922;white-space:nowrap;">STT Key</span>
                <input id="sj-stt-sf-key-inp" type="password" placeholder="SiliconFlow sk-...（短音频）" value="${sttGetSiliconFlowKey() ? '********' : ''}" style="background:#161b22;border:1px solid #30363d;border-radius:4px;color:#e6edf3;padding:4px 8px;font-size:12px;outline:none;">
                <span style="color:#6e7681;white-space:nowrap;">+</span>
                <input id="sj-stt-groq-key-inp" type="password" placeholder="Groq gsk_...（长音频）" value="${sttGetGroqKey() ? '********' : ''}" style="background:#161b22;border:1px solid #30363d;border-radius:4px;color:#e6edf3;padding:4px 8px;font-size:12px;outline:none;">
                <button id="sj-stt-key-btn" style="background:#238636;color:#fff;border:none;border-radius:4px;padding:4px 10px;cursor:pointer;font-size:12px;white-space:nowrap;">保存并识别</button>
            </div>`;
        bar.querySelector('#sj-stt-key-btn').addEventListener('click', () => {
            const sf = bar.querySelector('#sj-stt-sf-key-inp').value.trim();
            const groq = bar.querySelector('#sj-stt-groq-key-inp').value.trim();
            if (sf && sf !== '********') sttSaveSiliconFlowKey(sf);
            if (groq && groq !== '********') sttSaveGroqKey(groq);
            if (!sttHasAnyProviderKey()) return;
            sttProcess(audio, dialogBody);
        });
    }

    function sttRenderSuccess(bar, dialogBody, segments, audio) {
        const targetInput = findCorrespondingTextarea(audio.src);
        const fillBtnText = targetInput ? '✍️ 填入原框' : '📋 复制文本';

        bar.innerHTML = `
            <div style="display:flex; align-items:center; gap:12px; flex:1;">
                <span style="color:#3fb950; font-weight:bold; white-space:nowrap;">🤖 AI 字幕已就绪</span>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
                ${sttRenderAiToggleButton()}
                <button id="sj-stt-btn-fill" style="background:#238636; color:#fff; border:none; border-radius:4px; padding:4px 10px; cursor:pointer; font-size:12px; font-weight:bold; display:flex; align-items:center; gap:4px; transition:background 0.2s;">
                    ${fillBtnText}
                </button>
                <button id="sj-stt-cache-clear" title="清除该音频的 AI 识别缓存并重新识别" style="background:none; border:none; color:#f85149; cursor:pointer; font-size:11px; outline:none; font-weight:bold; margin-right:4px;">清除缓存</button>
                <button id="sj-stt-key-clear" title="重新填写 API Key" style="background:none; border:none; color:#6e7681; cursor:pointer; font-size:11px; outline:none;">重置Key</button>
            </div>`;

        const fillBtn = bar.querySelector('#sj-stt-btn-fill');
        const clearBtn = bar.querySelector('#sj-stt-key-clear');
        const clearCacheBtn = bar.querySelector('#sj-stt-cache-clear');
        sttBindAiToggle(bar, audio, dialogBody, false);

        const fullText = segments.map(s => s.text.trim()).join('');
        fillBtn.addEventListener('click', () => {
            const currentTargetInput = findCorrespondingTextarea(audio.src);
            if (currentTargetInput) {
                fillTextarea(currentTargetInput, fullText);
                autoReviewToast('✅ 已成功替换输入框文本！');
            } else {
                navigator.clipboard.writeText(fullText).then(() => {
                    autoReviewToast('⚠️ 未找到输入框，已复制文本到剪贴板！', true);
                }).catch(() => {
                    autoReviewToast('❌ 复制失败，请手动选择文字复制。', true);
                });
            }
        });

        clearBtn.addEventListener('click', () => {
            localStorage.removeItem(STT_KEY_LS);
            localStorage.removeItem(SF_KEY_LS);
            const currentAudio = document.querySelector('.el-dialog audio, .el-dialog__wrapper audio');
            sttRenderKeyPrompt(bar, currentAudio, dialogBody);
        });

        clearCacheBtn.addEventListener('click', () => {
            sessionStorage.removeItem(STT_CACHE_PREFIX + audio.src);
            sessionStorage.removeItem('stt_cache_' + audio.src);
            delete sttCurrentOrderTranscripts[audio.src]; // 清理全局引用
            autoReviewToast('🧹 缓存已清理，正在重新发起 AI 识别...', false);
            sttProcess(audio, dialogBody);
        });

        // 联动更新 Q10 / Q15 面板下方的 AI 线索卡片
        sttCurrentOrderTranscripts[audio.src] = segments;
        sttUpdateContextualTips();
    }

    function sttRenderNativeReuse(bar, dialogBody, segments, audio) {
        sttRestoreNativeSubtitles(audio, segments);
        const analysis = sttAnalyzeBusinessClues(segments, audio && audio.src || 'native://dialog');
        const matchedKinds = [];
        if (analysis.price.length > 0) matchedKinds.push('Q10价格');
        if (analysis.stock.length > 0) matchedKinds.push('Q15库存');
        const statusText = matchedKinds.length > 0
            ? `原生字幕命中：${matchedKinds.join('、')}，未调用AI`
            : '已回退原生字幕；未发现价格/库存线索';
        const statusColor = matchedKinds.length > 0 ? '#3fb950' : '#d29922';
        bar.innerHTML = `
            <div style="display:flex; align-items:center; gap:12px; flex:1;">
                <span style="color:${statusColor}; font-weight:bold; white-space:nowrap;">${statusText}</span>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
                ${sttRenderAiToggleButton()}
                <button id="sj-stt-force-ai" title="跳过原生字幕，强制调用 AI 重新识别" style="background:#238636;color:#fff;border:none;border-radius:4px;padding:4px 10px;cursor:pointer;font-size:12px;font-weight:bold;">强制AI</button>
            </div>`;

        const forceBtn = bar.querySelector('#sj-stt-force-ai');
        sttBindAiToggle(bar, audio, dialogBody, false);
        if (forceBtn) {
            forceBtn.addEventListener('click', () => {
                sttProcess(audio, dialogBody, true);
            });
        }

        sttCurrentOrderTranscripts[audio.src] = segments;
        sttUpdateContextualTips();
    }

    // 解析 SRT 格式时间戳：00:00:01,000 --> 00:00:04,000
    function parseSrtTime(timeStr) {
        const parts = timeStr.split(':');
        if (parts.length < 3) return 0;
        const h = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const sParts = parts[2].split(',');
        const s = parseInt(sParts[0], 10);
        const ms = sParts.length > 1 ? parseInt(sParts[1], 10) : 0;
        return h * 3600 + m * 60 + s + ms / 1000;
    }

    function sttCoerceTimeSeconds(value) {
        if (Array.isArray(value)) {
            return sttCoerceTimeSeconds(value[0]);
        }
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (!trimmed) return NaN;
            if (/^\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}$/.test(trimmed)) return parseSrtTime(trimmed.replace('.', ','));
            if (/^\d{1,2}:\d{2}(?:[,.]\d{1,3})?$/.test(trimmed)) {
                const parts = trimmed.replace(',', '.').split(':');
                return Number(parts[0]) * 60 + Number(parts[1]);
            }
        }
        const n = Number(value);
        if (!Number.isFinite(n)) return NaN;
        return n > 10000 ? n / 1000 : n;
    }

    function sttSegmentFromObject(item, fallbackDuration) {
        if (!item || typeof item !== 'object') return null;
        const text = String(
            item.text || item.content || item.sentence || item.transcript || item.word || item.words || ''
        ).trim();
        if (!text) return null;

        const timestamp = item.timestamp || item.timestamps || item.timeRange || item.range;
        let start = sttCoerceTimeSeconds(
            item.start ?? item.start_time ?? item.startTime ?? item.begin ?? item.begin_time ?? item.beginTime ??
            item.from ?? item.offset ?? item.time ?? (Array.isArray(timestamp) ? timestamp[0] : timestamp)
        );
        let end = sttCoerceTimeSeconds(
            item.end ?? item.end_time ?? item.endTime ?? item.finish ?? item.finish_time ?? item.finishTime ??
            item.to ?? (Array.isArray(timestamp) ? timestamp[1] : undefined)
        );
        const duration = sttCoerceTimeSeconds(item.duration ?? item.dur);
        const hasStart = Number.isFinite(start);
        if (!Number.isFinite(start)) start = 0;
        if (!Number.isFinite(end)) {
            end = Number.isFinite(duration) && duration > 0 ? start + duration : (fallbackDuration || start);
        }
        return {
            start,
            end,
            text,
            timeUnreliable: !hasStart
        };
    }

    function parseSrt(srtText) {
        const blocks = srtText.trim().split(/\n\s*\n/);
        const result = [];
        for (const block of blocks) {
            const lines = block.split('\n');
            if (lines.length >= 3) {
                const timeLine = lines[1];
                const textLine = lines.slice(2).join(' ').trim();
                const timeMatch = timeLine.match(/(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/);
                if (timeMatch && textLine) {
                    result.push({
                        start: parseSrtTime(timeMatch[1]),
                        end: parseSrtTime(timeMatch[2]),
                        text: textLine
                    });
                }
            }
        }
        return result;
    }

    // 匹配页面上的相应输入框/文本框
    function findCorrespondingTextarea(audioSrc) {
        if (!audioSrc) return null;

        const urlParts = audioSrc.split('/');
        const filename = urlParts[urlParts.length - 1];
        if (!filename) return null;

        const cleanFilename = filename.split('?')[0];

        const reviews = document.querySelectorAll('.answer--review');
        for (const review of reviews) {
            // 1. 检测 audio 元素 src
            const audios = review.querySelectorAll('audio');
            for (const aud of audios) {
                if (aud.src && aud.src.includes(cleanFilename)) {
                    return review.querySelector('textarea, input[type="text"], .el-textarea__inner, .el-input__inner');
                }
            }

            // 2. 检测 a 链接 href 或内容
            const links = review.querySelectorAll('a');
            for (const link of links) {
                if (link.href && link.href.includes(cleanFilename)) {
                    return review.querySelector('textarea, input[type="text"], .el-textarea__inner, .el-input__inner');
                }
                if (link.textContent && link.textContent.includes(cleanFilename)) {
                    return review.querySelector('textarea, input[type="text"], .el-textarea__inner, .el-input__inner');
                }
            }

            // 3. 检测文本内容
            if (review.textContent && review.textContent.includes(cleanFilename)) {
                return review.querySelector('textarea, input[type="text"], .el-textarea__inner, .el-input__inner');
            }

            // 4. 遍历所有子元素属性进行深度查找
            const allEls = review.querySelectorAll('*');
            for (const el of allEls) {
                for (const attr of el.attributes) {
                    if (attr.value && attr.value.includes(cleanFilename)) {
                        return review.querySelector('textarea, input[type="text"], .el-textarea__inner, .el-input__inner');
                    }
                }
            }
        }
        return null;
    }

    // 填入 Vue 绑定的文本框并触发事件以防丢失响应性
    function fillTextarea(textarea, text) {
        if (!textarea) return false;
        textarea.value = text;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }

    function sttEnsureSentencePunctuation(text) {
        const clean = String(text || '').replace(/[ \t]+/g, ' ').trim();
        if (!clean || /[，。？！；;,.!?]$/.test(clean)) return clean;
        const normalized = sttNormalizeBusinessText(clean);
        const looksLikeQuestion = /请问|多少|几(?:箱|件|块)|有没有|还有吗|吗|么|呢|怎么卖|什么价|贵不贵/.test(normalized);
        return clean + (looksLikeQuestion ? '？' : '。');
    }

    // 将 AI 识别文本按标点拆分为短句；普通空格不是句界，不能据此打碎文本。
    function splitIntoPhrases(text) {
        const rawParts = String(text || '').split(/([，。？！、\n；;]+)/);
        const phrases = [];
        for (let i = 0; i < rawParts.length; i += 2) {
            const words = rawParts[i] || '';
            const punct = rawParts[i + 1] || '';
            const combined = (words + punct).trim();
            if (combined) {
                phrases.push(combined);
            }
        }
        return phrases;
    }

    function sttSegmentsToDisplayPhrases(segments) {
        const phrases = [];
        (segments || []).forEach(seg => {
            const parts = splitIntoPhrases(seg && seg.text || '');
            if (parts.length === 0) return;
            parts.forEach(part => {
                const readable = sttEnsureSentencePunctuation(part);
                if (readable) phrases.push(readable);
            });
        });
        return phrases;
    }

    // 调整切分段落数精确等于原生字幕 li 数量 N
    function adjustSegmentCount(phrases, N) {
        if (phrases.length === 0) {
            return Array(N).fill('');
        }
        let segments = [...phrases];

        // 数量过多：合并长度最短的相邻项
        while (segments.length > N) {
            let bestIdx = 0;
            let minLen = Infinity;
            for (let i = 0; i < segments.length - 1; i++) {
                const combinedLen = segments[i].length + segments[i+1].length;
                if (combinedLen < minLen) {
                    minLen = combinedLen;
                    bestIdx = i;
                }
            }
            const separator = /[，。？！；;,.!?]$/.test(segments[bestIdx]) ? '' : '，';
            segments[bestIdx] = segments[bestIdx] + separator + segments[bestIdx + 1];
            segments.splice(bestIdx + 1, 1);
        }

        // 数量过少时保留模型原始分段，剩余字幕行留空，绝不从句子中间硬切。
        while (segments.length < N) segments.push('');
        return segments;
    }

    let sttObserver = null;
    const sttNativeSubtitleSnapshots = new Map();

    function sttAudioKey(src) {
        try {
            const clean = String(src || '').split('?')[0];
            return clean.substring(clean.lastIndexOf('/') + 1);
        } catch {
            return String(src || '');
        }
    }

    function sttCurrentDialogAudioKey() {
        const audio = document.querySelector('.el-dialog audio, .el-dialog__wrapper audio');
        return audio && audio.src ? sttAudioKey(audio.src) : '';
    }

    // 建立 MutationObserver 监听，确保 Vue 重绘时能自动锁定并重写为 AI 字幕
    function observeSubtitles(listItems, aiSegments, sourceSrc) {
        if (sttObserver) {
            sttObserver.disconnect();
            sttObserver = null;
        }

        const targetUl = document.querySelector('.audio-player-lyric ul');
        if (!targetUl) return;
        const sourceKey = sttAudioKey(sourceSrc);

        sttObserver = new MutationObserver(() => {
            if (sourceKey && sttCurrentDialogAudioKey() !== sourceKey) {
                sttObserver.disconnect();
                sttObserver = null;
                return;
            }
            sttObserver.disconnect();

            listItems.forEach((li, idx) => {
                const span = li.querySelector('span');
                const text = aiSegments[idx] || '';
                li.style.display = text.trim() ? '' : 'none';
                if (span && span.textContent !== text) {
                    span.textContent = text;
                }
            });

            sttObserver.observe(targetUl, {
                childList: true,
                characterData: true,
                subtree: true
            });
        });

        sttObserver.observe(targetUl, {
            childList: true,
            characterData: true,
            subtree: true
        });
    }

    // 替换原文字幕（不影响点击跳转和播放样式，完美融入原生 UI）
    function replaceNativeSubtitles(segments, sourceSrc) {
        const listItems = document.querySelectorAll('.audio-player-lyric ul li');
        if (!listItems || listItems.length === 0) return false;
        const sourceKey = sttAudioKey(sourceSrc);
        if (sourceKey && sttCurrentDialogAudioKey() && sttCurrentDialogAudioKey() !== sourceKey) return false;

        const targetUl = document.querySelector('.audio-player-lyric ul');
        if (sourceKey && targetUl && targetUl.dataset.sjSttMode !== 'ai') {
            const currentAudio = document.querySelector('.el-dialog audio, .el-dialog__wrapper audio');
            const nativeSnapshot = sttGetNativeSubtitleSegments(currentAudio);
            if (nativeSnapshot.length > 0) sttNativeSubtitleSnapshots.set(sourceKey, nativeSnapshot);
        }

        const N = listItems.length;
        // 保留 API 自带的段落/停顿边界；旧逻辑无分隔 join 后再硬切，导致字幕杂乱且无标点。
        const phrases = sttSegmentsToDisplayPhrases(segments);
        const aiSegments = adjustSegmentCount(phrases, N);

        listItems.forEach((li, idx) => {
            const span = li.querySelector('span');
            const text = aiSegments[idx] || '';
            li.style.display = text.trim() ? '' : 'none';
            if (span) {
                span.textContent = text;
            }
        });

        if (targetUl) {
            targetUl.dataset.sjSttSource = sourceKey;
            targetUl.dataset.sjSttMode = 'ai';
        }
        observeSubtitles(listItems, aiSegments, sourceSrc);
        return true;
    }

    function sttGetNativeSubtitleSegments(audio) {
        const currentKey = sttAudioKey(audio && audio.src);
        const targetUl = document.querySelector('.audio-player-lyric ul');
        if (targetUl && targetUl.dataset.sjSttMode === 'ai') {
            return sttNativeSubtitleSnapshots.get(currentKey) || [];
        }
        if (targetUl && targetUl.dataset.sjSttSource) {
            const sourceKey = targetUl.dataset.sjSttSource || '';
            if (sourceKey && currentKey && sourceKey !== currentKey) return [];
        }
        let listItems = Array.from(document.querySelectorAll('.audio-player-lyric ul li, .audio-player-lyric li'));
        if (!listItems || listItems.length === 0) {
            const lyricBox = document.querySelector('.audio-player-lyric');
            const fallbackLines = (lyricBox && lyricBox.innerText || '')
                .split(/\n+/)
                .map(t => t.replace(/\s+/g, ' ').trim())
                .filter(Boolean);
            listItems = fallbackLines.map((text, idx) => ({ textContent: text, dataset: {}, getAttribute: () => '', __fallbackIndex: idx }));
        }
        if (!listItems || listItems.length === 0) return [];

        const duration = Number(audio && audio.duration) || 0;
        const count = listItems.length;
        const segments = [];

        listItems.forEach((li, idx) => {
            const text = (li.textContent || '').replace(/\s+/g, ' ').trim();
            if (!text) return;
            const attrTime =
                li.getAttribute('data-time') ||
                li.getAttribute('data-start') ||
                li.getAttribute('data-start-time') ||
                li.getAttribute('data-begin') ||
                li.dataset.time ||
                li.dataset.start ||
                li.dataset.startTime ||
                li.dataset.begin ||
                '';
            let start = sttCoerceTimeSeconds(attrTime);
            const hasNativeTime = Number.isFinite(start);
            if (!Number.isFinite(start)) {
                start = duration > 0 && count > 0 ? duration * idx / count : idx * 3;
            }
            const end = duration > 0 && count > 0 ? duration * (idx + 1) / count : start + 3;
            segments.push({ start, end, text, timeUnreliable: !hasNativeTime });
        });

        return segments;
    }

    function sttRestoreNativeSubtitles(audio, fallbackSegments) {
        const currentKey = sttAudioKey(audio && audio.src);
        const targetUl = document.querySelector('.audio-player-lyric ul');
        const listItems = Array.from(document.querySelectorAll('.audio-player-lyric ul li'));
        if (!targetUl || listItems.length === 0) return false;

        const snapshot = sttNativeSubtitleSnapshots.get(currentKey) || fallbackSegments || [];
        if (!snapshot.length) return false;
        if (sttObserver) {
            sttObserver.disconnect();
            sttObserver = null;
        }

        const restoredLines = snapshot.length === listItems.length
            ? snapshot.map(seg => String(seg.text || '').trim())
            : adjustSegmentCount(sttSegmentsToDisplayPhrases(snapshot), listItems.length);
        listItems.forEach((li, idx) => {
            const text = restoredLines[idx] || '';
            const span = li.querySelector('span');
            li.style.display = text ? '' : 'none';
            if (span) span.textContent = text;
        });
        delete targetUl.dataset.sjSttSource;
        delete targetUl.dataset.sjSttMode;
        return true;
    }

    // 深度搜索 Vue 组件树和 Vuex 状态库，抓取已下载的原生字幕数据（无需弹窗/播放器加载到 DOM）
    function sttFindNativeSubtitlesInVue(audioUrl) {
        if (!audioUrl) return [];
        const audioKey = sttAudioKey(audioUrl); // E.g. "139146_15375271.mp3"
        if (!audioKey) return [];

        const visited = new Set();
        let foundSegs = [];

        function scan(obj, depth = 0) {
            if (!obj || depth > 8 || foundSegs.length > 0) return;
            if (typeof obj !== 'object') return;
            if (visited.has(obj)) return;
            visited.add(obj);

            // 检查当前对象是否包含该音频的标识符
            let hasAudioUrl = false;
            for (const key in obj) {
                try {
                    if (Object.prototype.hasOwnProperty.call(obj, key)) {
                        const val = obj[key];
                        if (typeof val === 'string' && val.includes(audioKey)) {
                            hasAudioUrl = true;
                            break;
                        }
                    }
                } catch {}
            }

            // 如果当前对象绑定了该音频，深度检索其同级属性中的文本或段落数据
            if (hasAudioUrl) {
                for (const key in obj) {
                    try {
                        if (Object.prototype.hasOwnProperty.call(obj, key)) {
                            const val = obj[key];
                            // 情况A：字幕以数组段落形式存在
                            if (Array.isArray(val) && val.length > 0) {
                                const first = val[0];
                                if (first && typeof first === 'object' && (first.text || first.content) && /[\u4e00-\u9fa5]/.test(first.text || first.content || '')) {
                                    foundSegs = val.map(item => sttSegmentFromObject(item, 0)).filter(Boolean);
                                    return;
                                }
                            }
                            // 情况B：字幕为单条长文本（过滤 URL 和 CDN 域名）
                            if (typeof val === 'string' && val.length > 10 && /[\u4e00-\u9fa5]/.test(val) && !val.includes('http') && !val.includes('sjaudiopub')) {
                                const fallbackDuration = sttParseDurationFromSrc(audioUrl) || 0;
                                if (val.includes('-->') || val.includes('\n')) {
                                    foundSegs = parseApiResponse(val, fallbackDuration);
                                } else {
                                    foundSegs = [{ start: 0, end: fallbackDuration, text: val.trim(), timeUnreliable: true }];
                                }
                                return;
                            }
                        }
                    } catch {}
                }
            }

            // 递归扫描子属性
            if (Array.isArray(obj)) {
                for (let i = 0; i < obj.length; i++) {
                    scan(obj[i], depth + 1);
                }
            } else {
                for (const key in obj) {
                    if (Object.prototype.hasOwnProperty.call(obj, key)) {
                        if (key.startsWith('_') && key !== '_data' && key !== '_props') continue;
                        if (['$el', '$parent', '$root', 'constructor', 'sys'].includes(key)) continue;
                        scan(obj[key], depth + 1);
                    }
                }
            }
        }

        // 获取页面所有的 Vue 根实例并开启扫描
        const seedEls = document.querySelectorAll('*');
        const visitedComponents = new Set();
        for (const el of seedEls) {
            if (el.__vue__) {
                let rootVm = el.__vue__;
                while (rootVm.$parent) {
                    rootVm = rootVm.$parent;
                }
                if (visitedComponents.has(rootVm)) continue;
                visitedComponents.add(rootVm);

                function scanVueComponent(vm) {
                    if (!vm) return;
                    scan(vm, 0);
                    if (foundSegs.length > 0) return;
                    
                    if (vm.$store && vm.$store.state) {
                        scan(vm.$store.state, 0);
                        if (foundSegs.length > 0) return;
                    }
                    if (vm.$children && Array.isArray(vm.$children)) {
                        for (const child of vm.$children) {
                            scanVueComponent(child);
                            if (foundSegs.length > 0) return;
                        }
                    }
                }
                scanVueComponent(rootVm);
                if (foundSegs.length > 0) break;
            }
        }

        return foundSegs;
    }

    function sttNativeHasUsefulBusinessSignal(segments) {
        const analysis = sttAnalyzeBusinessClues(segments, 'native://probe');
        return analysis.price.length > 0 || analysis.stock.length > 0;
    }

    function sttTryUseNativeSubtitles(audio, dialogBody, bar, reason) {
        if (!audio || !audio.src) return false;
        const nativeSegs = sttGetNativeSubtitleSegments(audio);
        if (nativeSegs && nativeSegs.length > 0 && sttNativeHasUsefulBusinessSignal(nativeSegs)) {
            console.log(`[STT] Using native subtitles (${reason || 'matched'}), skipping/falling back from AI:`, audio.src);
            sttWriteCache(audio.src, nativeSegs);
            sttRenderNativeReuse(bar, dialogBody, nativeSegs, audio);
            return true;
        }
        return false;
    }

    // 宽松版原生字幕回退：只要有字幕内容就展示，不检查业务信号。
    // 用于 AI 报错 / 幻觉 场景——"展示原生字幕"永远比"显示一条报错"对用户更有帮助。
    function sttTryUseNativeSubtitlesFallback(audio, dialogBody, bar, reason) {
        if (!audio || !audio.src) return false;
        const nativeSegs = sttGetNativeSubtitleSegments(audio);
        if (nativeSegs && nativeSegs.length > 0) {
            console.log(`[STT] Lenient native fallback (${reason}), showing native subtitles regardless of business signal:`, audio.src);
            sttWriteCache(audio.src, nativeSegs);
            sttRenderNativeReuse(bar, dialogBody, nativeSegs, audio);
            return true;
        }
        return false;
    }

    async function sttWaitAndUseNativeSubtitles(audio, dialogBody, bar, reason, timeoutMs = 2500) {
        const start = Date.now();
        while (Date.now() - start <= timeoutMs) {
            if (sttTryUseNativeSubtitles(audio, dialogBody, bar, reason)) return true;
            await autoReviewSleep(120);
        }
        return false;
    }

    async function sttWaitAndUseNativeSubtitlesLenient(audio, dialogBody, bar, reason, timeoutMs = 2500) {
        const start = Date.now();
        while (Date.now() - start <= timeoutMs) {
            if (sttTryUseNativeSubtitlesFallback(audio, dialogBody, bar, reason)) return true;
            await autoReviewSleep(120);
        }
        return false;
    }

    function sttGetNativeSubtitleSegmentsByUrl(url) {
        if (!url) return [];
        let nativeSegs = [];
        const audio = document.querySelector('.el-dialog audio, .el-dialog__wrapper audio');
        if (audio && sttAudioKey(audio.src) === sttAudioKey(url)) {
            nativeSegs = sttGetNativeSubtitleSegments(audio);
        }
        if (!nativeSegs || nativeSegs.length === 0) {
            nativeSegs = sttFindNativeSubtitlesInVue(url);
        }
        return nativeSegs || [];
    }

    function sttTryUseNativeSubtitlesByUrl(url, reason) {
        if (!url) return false;
        const httpsUrl = url.replace(/^http:\/\//i, 'https://');
        const nativeSegs = sttGetNativeSubtitleSegmentsByUrl(url);
        if (nativeSegs && nativeSegs.length > 0 && sttNativeHasUsefulBusinessSignal(nativeSegs)) {
            console.log(`[STT AutoScan] Using native subtitles (${reason || 'matched'}), skipping AI API:`, url);
            sttWriteCache(httpsUrl, nativeSegs);
            sttWriteCache(url, nativeSegs);
            sttCurrentOrderTranscripts[url] = nativeSegs;
            sttUpdateContextualTips();
            return true;
        }
        return false;
    }

    async function sttWaitAndUseNativeSubtitlesByUrl(url, reason, timeoutMs = 2500) {
        const start = Date.now();
        while (Date.now() - start <= timeoutMs) {
            if (sttTryUseNativeSubtitlesByUrl(url, reason)) return true;
            await autoReviewSleep(160);
        }
        return false;
    }

    // 检测是否为 Whisper 底层静音/噪声产生的幻觉段落
    function sttIsHallucination(text) {
        if (!text) return true;
        // 匹配常见的 Whisper 幻觉模式，包含各种点赞、订阅、明镜电视等新闻和YouTube台词
        const regex = /谢谢(收看|观看|订阅|大家|支持)|订阅(频道|我们|转发|打赏)|点赞(订阅|转发|打赏|支持)|点击订阅|阅读订阅|视频被订阅|连续电话|本集完|感谢观看|请不吝|明镜|Amara|字幕(组|志愿者|提供)|网易云|下期(再见|视频)|收看我们|非常感谢|YouTube|Youtube|television|series|terms|Foster|companion|astronom|zwi[a-z]*|全球首发|独播剧场|电视剧|人类拯救|用于我自己的生命|频道|微博.*广告|抢购|会员|医生|玩具|研究室|新增约束|太阳的|表里|新闻|搜索|热搜|保证这张搜索|放在顶部|红色的红色|10月20日|发生火灾|冰沙路|洛杉矶|长沙山市|外国人发现|更好的生活|中央小区|东业务司|蔡工房|迷尿|忠明|记者|黄鹤楼|四绷/i;
        const compact = text.replace(/\s+/g, '');
        if (regex.test(text)) return true;
        const businessNormalized = sttNormalizeBusinessText(text);
        const businessHits = (businessNormalized.match(/脉动|电解质|1L|库存|仓库|现货|整箱|多少钱|价格|价钱|几箱|几件|多少箱|还有货|有没有|\d+\s*(?:箱|件)|[一二三四五六七八九十百两]+(?:箱|件)|元|块/g) || []).length;
        const hasBusinessWord = businessHits > 0;
        const latinMatches = text.match(/[A-Za-z]{2,}/g) || [];
        const latinChars = latinMatches.join('').length;
        const nonCnNoise = text.match(/[ぁ-んァ-ンа-яА-Я�]/g) || [];
        if (!hasBusinessWord && (latinChars >= 10 || nonCnNoise.length >= 2)) {
            return true;
        }
        // 很多短音/静音会被识别成连续的寒暄和无意义口头词，这类不进入业务线索抽取。
        if (compact.length <= 24 && /^(啊|嗯|好|好的|谢谢|你看|不是|可以|走了|对吗|是的|不要去|开始|第一|喂|喂呀)+$/.test(compact)) {
            return true;
        }
        if (!hasBusinessWord && compact.length <= 10 && /^(老板|你好|您好|老公|没事|说案子|代理|新增约束)+$/.test(compact)) {
            return true;
        }
        if (compact.length > 500 && businessHits < 4) return true;
        if (compact.length > 280 && businessHits < 2 && /谢谢|拜拜|记者|妈妈|爸爸|公司|业务|照片|过来|出去/.test(compact)) return true;
        return false;
    }

    // 清理 AI 识别出的文本：去除连续重复句
    function sttCleanText(text) {
        if (!text) return '';
        const rawParts = text.split(/([，。？！、\n；;]+)/);
        const phrases = [];
        for (let i = 0; i < rawParts.length; i += 2) {
            const words = rawParts[i] || '';
            const punct = rawParts[i + 1] || '';
            const combined = (words + punct).trim();
            if (combined) {
                const cleanWord = words.trim();
                // 1. 过滤常见的 Whisper 静音/噪声极短幻觉词（作为双重保险）
                if (sttIsHallucination(cleanWord) || /谢谢(收看|观看|订阅|大家)|订阅(频道|我们)|字幕|Amara|volunteer/i.test(cleanWord)) {
                    continue;
                }
                // 2. 连续重复句去重
                if (phrases.length > 0) {
                    const prevPhrase = phrases[phrases.length - 1];
                    const prevClean = prevPhrase.replace(/[，。？！、\s\n；;]+/g, '').trim();
                    const currClean = cleanWord.replace(/[，。？！、\s\n；;]+/g, '').trim();
                    if (prevClean && currClean && prevClean === currClean) {
                        continue;
                    }
                }
                phrases.push(combined);
            }
        }
        return phrases.join('');
    }

    function sttEscapeHtml(text) {
        return String(text || '').replace(/[&<>"']/g, ch => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[ch]);
    }

    function sttFormatTime(seconds) {
        const s = Math.max(0, Math.floor(Number(seconds) || 0));
        const m = Math.floor(s / 60);
        const sec = String(s % 60).padStart(2, '0');
        return `${m}:${sec}`;
    }

    // 把常见谐音/错字先归一成业务词，再做 Q10/Q15 判断。
    function sttNormalizeBusinessText(text) {
        let t = String(text || '');
        const rules = [
            [/卖动|麦动|麦豆|脉豆|迈动|脉懂|脉东|脉董|脉冻|脉通|脉同|买动|脉洞|故划通|故划|麦通/g, '脉动'],
            [/电解字|电解值|电解至|电解纸|电解制|电解智|电解子|电解汁|电解植|长烦|长瓶|电解/g, '电解质'],
            [/医生(?=.{0,10}(?:多少钱|价格|价钱|几块|块|元))/g, '1L'],
            [/(多少钱|价格|价钱|几块|\d+(?:\.\d+)?(?:块|元)).{0,10}医生/g, '$1 1L'],
            [/(?:一生|一身)(?=.{0,10}(?:多少钱|价格|价钱|几块|块|元))/g, '1L'],
            [/一\s*[lL]|1\s*[lL]|一升|1升|大瓶子|大瓶的|大平|大品|大屏|大瓶装/g, '1L'],
            [/一起见货|一其见货|一齐见货/g, '一共几件货'],
            [/见货|现获/g, '现货'],
            [/库村|库层|库纯|库存在|存货|存库|库有|还有整箱|有整箱|整箱的吗|整箱吗/g, '库存整箱'],
            [/有木有|有么有|有没有货|还有货吗|还有没有货/g, '有没有'],
            [/多钱|几块钱|几块|多少一瓶|多少钱一瓶|售价/g, '多少钱'],
            [/那洒|那啥|那个啥/g, '那个']
        ];
        rules.forEach(([from, to]) => {
            t = t.replace(from, to);
        });
        return t;
    }

    function sttHasUsefulBusinessSignal(segments) {
        const text = (segments || []).map(s => s.text || '').join('');
        const normalized = sttNormalizeBusinessText(text);
        const businessHits = (normalized.match(/脉动|电解质|1L|库存|仓库|现货|整箱|多少钱|价格|几箱|几件|还有货|\d+\s*(?:箱|件)|[一二三四五六七八九十百两]+(?:箱|件)|元|块/g) || []).length;
        const junkHits = (text.match(/新闻|订阅|广告|YouTube|terms|companion|astronom|大阪|中国.*美食|洛杉矶|火灾|投票|pseud|firstly|黄蕉|苏都市|小菜店|食物店|网络订阅|故事|妈妈|爸爸|医生|客户|利益|费用|汽车|药方|计算机|克罗|创业网站|欢迎加入|每个人都能通过|东业务司|蔡工房|迷尿|忠明|记者|黄鹤楼|四绷/g) || []).length;
        const latinChars = ((text.match(/[A-Za-z]{2,}/g) || []).join('')).length;
        const textLen = text.replace(/\s+/g, '').length;
        const hasProduct = /脉动|电解质|1L/.test(normalized);
        const hasBusinessQuestion = /库存|仓库|现货|整箱|多少钱|价格|几箱|几件|还有货|有没有|\d+\s*(?:箱|件)|[一二三四五六七八九十百两]+(?:箱|件)|元|块/.test(normalized);
        // 单独出现“块/元”等普通词不能证明 AI 识别正确，必须同时有产品主题和价格/库存意图。
        if (!hasProduct || !hasBusinessQuestion) return false;
        if (junkHits >= 2) return false;
        if (latinChars >= 20) return false;
        if (textLen > 120 && businessHits === 0) return false;
        if (textLen > 500 && businessHits < 4) return false;
        if (textLen > 280 && businessHits < 2) return false;
        if (businessHits >= 2) return true;
        if (businessHits >= 1 && junkHits <= 1 && latinChars < 12) return true;
        return false;
    }

    function sttSplitSentencesWithTime(seg) {
        const text = (seg && seg.text || '').trim();
        if (!text) return [];
        const parts = text.match(/[^，。！？；;,.!?]+[，。！？；;,.!?]?/g) || [text];
        const start = Number(seg.start) || 0;
        const end = Number(seg.end) || start;
        const duration = Math.max(0, end - start);
        const hasReliableTime = !seg.timeUnreliable && Number.isFinite(Number(seg.start));
        const hasEstimatedTime = !!seg.timeUnreliable && duration > 0 && parts.length > 1;
        return parts.map((raw, idx) => {
            const partStart = parts.length > 1 ? start + duration * idx / parts.length : start;
            const partEnd = parts.length > 1 ? start + duration * (idx + 1) / parts.length : end;
            return {
                raw: raw.trim(),
                normalized: sttNormalizeBusinessText(raw.trim()),
                start: partStart,
                end: partEnd,
                hasReliableTime,
                hasEstimatedTime
            };
        }).filter(item => item.raw);
    }

    function sttIsLikelyBusinessAnswer(kind, item) {
        if (!item || !item.raw || sttIsHallucination(item.raw)) return false;
        const normalized = item.normalized || sttNormalizeBusinessText(item.raw);
        const compact = normalized.replace(/[，。？！、\s\n；;,.!?]+/g, '');
        if (compact.length < 1) return false;

        if (/不知道|不清楚|不晓得|没问|没数|没盘|没看|记不清|说不准|忘了|没说/.test(normalized)) return true;
        if (kind === 'price') {
            return /\d+(?:\.\d+)?\s*(?:元|块|毛|角)|[一二三四五六七八九十百两半]+(?:元|块|毛|角)|(?:卖|售价|价格|价钱|一瓶|一件).{0,8}\d/.test(normalized);
        }
        return /\d+(?:\.\d+)?\s*(?:箱|件|瓶|提)|[一二三四五六七八九十百两半]+(?:箱|件|瓶|提)|有货|有的|还有|还有些|没有|没货|没了|卖完|断货|缺货|零箱|一箱都没/.test(normalized);
    }

    function sttCollectFollowingAnswers(kind, items, questionIndex) {
        const question = items[questionIndex];
        if (!question) return [];
        const answers = [];
        // 只检查同一录音紧随问题的两句，避免把下一段录音或远处无关数字拼进来。
        for (let offset = 1; offset <= 2; offset++) {
            const candidate = items[questionIndex + offset];
            if (!candidate || candidate.audioUrl !== question.audioUrl) break;
            if (sttIsLikelyBusinessAnswer(kind, candidate)) answers.push(candidate);
        }
        return answers;
    }

    function sttBuildBusinessClues(kind, transcripts = sttCurrentOrderTranscripts) {
        const items = [];
        for (const audioUrl in transcripts) {
            const segs = transcripts[audioUrl];
            if (!Array.isArray(segs)) continue;
            segs.forEach(seg => {
                sttSplitSentencesWithTime(seg).forEach(item => {
                    item.audioUrl = audioUrl;
                    items.push(item);
                });
            });
        }

        const clues = [];
        const seen = new Set();
        const brandRe = /脉动/;
        const sizeRe = /1L|1升|一升|大瓶/;
        const electrolyteRe = /电解质/;
        const priceRe = /价格|多少钱|几块|块钱|售价|多少一|贵不贵|元一瓶|\d+(?:\.\d+)?\s*(元|块|毛|角)/;
        const stockRe = /库存|仓库|现货|整箱|有整箱|还有整箱|几箱|几件|多少箱|还有没有|有没有货|还有货|还有多少|有多少箱|剩多少|卖完|断货|进货|\d+\s*(?:箱|件)|[一二三四五六七八九十百两]+(?:箱|件)|箱/;

        items.forEach((item, idx) => {
            if (sttIsHallucination(item.raw)) return;
            const prev = items[idx - 1];
            const next = items[idx + 1];
            const context = [prev, item, next].filter(x => x && x.audioUrl === item.audioUrl);
            const contextNorm = context.map(x => x.normalized).join(' ');
            const currentNorm = item.normalized;
            const compact = currentNorm.replace(/[，。？！、\s\n；;,.!?]+/g, '');
            if (compact.length < 2) return;

            const hasBrand = brandRe.test(contextNorm);
            const hasSize = sizeRe.test(contextNorm);
            const hasElectrolyte = electrolyteRe.test(contextNorm);
            const hasPrice = priceRe.test(contextNorm);
            const hasStock = stockRe.test(contextNorm);
            const hasPriceCurrent = priceRe.test(currentNorm);
            const hasStockCurrent = stockRe.test(currentNorm);
            const hasExplicitPriceCurrent = /价格|售价|元|块|毛|角|几块|块钱/.test(currentNorm);
            const hasProductCurrent = brandRe.test(currentNorm) || sizeRe.test(currentNorm) || electrolyteRe.test(currentNorm);
            const isInventoryQuestionCurrent = /(库存|整箱|还有|剩|几箱|多少箱|有没有货|有整箱)/.test(currentNorm);
            const isBareHowMuchInventory = isInventoryQuestionCurrent && /多少钱|多少/.test(currentNorm) && !hasExplicitPriceCurrent && !hasProductCurrent;
            const priceCandidateCurrent = hasPriceCurrent && !isBareHowMuchInventory;
            const isPriceQuestionCurrent = priceCandidateCurrent && /多少|几块|贵不贵|怎么卖|什么价|问.{0,4}(价格|价钱)|吗|么|呢|？/.test(currentNorm);
            const isStockQuestionCurrent = hasStockCurrent && /几箱|几件|多少箱|多少件|有没有|还有多少|剩多少|有多少|一共|问.{0,8}(库存|仓库|现货|箱|件)|吗|么|呢|？/.test(currentNorm);

            let confidence = '';
            let reason = '';
            if (kind === 'price') {
                if (priceCandidateCurrent && hasBrand && (hasSize || hasElectrolyte) && (!hasStockCurrent || hasExplicitPriceCurrent || hasProductCurrent)) {
                    confidence = '高';
                    reason = '命中 脉动 + 1L/电解质 + 价格';
                } else if (priceCandidateCurrent && (hasBrand || hasSize || hasElectrolyte) && (!hasStockCurrent || hasExplicitPriceCurrent || hasProductCurrent)) {
                    confidence = '中';
                    reason = '命中 价格 + 脉动/1L/电解质';
                } else if ((sizeRe.test(currentNorm) || electrolyteRe.test(currentNorm) || (hasBrand && (hasSize || hasElectrolyte))) && !hasStockCurrent) {
                    confidence = '低';
                    reason = '疑似 Q10 产品段，未听清价格词';
                } else if (priceCandidateCurrent && !hasStockCurrent) {
                    confidence = '低';
                    reason = '仅命中价格问法';
                }
            } else {
                if (hasStockCurrent && hasBrand) {
                    confidence = '高';
                    reason = '命中 脉动 + 库存/箱数';
                } else if (hasStockCurrent) {
                    confidence = '中';
                    reason = '命中 库存/箱数问法';
                }
            }
            if (!confidence) return;

            const key = `${kind}-${compact}-${Math.round(item.start)}`;
            if (seen.has(key)) return;
            seen.add(key);

            const isQuestion = kind === 'price' ? isPriceQuestionCurrent : isStockQuestionCurrent;
            const answers = isQuestion ? sttCollectFollowingAnswers(kind, items, idx) : [];
            clues.push({
                confidence,
                reason,
                start: item.start,
                end: item.end,
                hasReliableTime: item.hasReliableTime,
                hasEstimatedTime: item.hasEstimatedTime,
                raw: item.raw,
                normalized: currentNorm,
                context: context.map(x => x.raw),
                answers: answers.map(answer => ({
                    raw: answer.raw,
                    normalized: answer.normalized,
                    start: answer.start,
                    end: answer.end
                })),
                audioUrl: item.audioUrl
            });
        });

        const rank = { '高': 3, '中': 2, '低': 1 };
        return clues
            .sort((a, b) => (rank[b.confidence] - rank[a.confidence]) || (a.start - b.start))
            .slice(0, 2);
    }

    function sttAnalyzeBusinessClues(segments, audioUrl = 'native://probe') {
        const transcripts = { [audioUrl]: Array.isArray(segments) ? segments : [] };
        return {
            price: sttBuildBusinessClues('price', transcripts),
            stock: sttBuildBusinessClues('stock', transcripts)
        };
    }

    function sttFormatBusinessClues(kind, clues) {
        const color = kind === 'price' ? '#facc15' : '#c084fc';
        const bg = kind === 'price' ? 'rgba(234, 179, 8, 0.10)' : 'rgba(168, 85, 247, 0.10)';
        if (!clues || clues.length === 0) {
            return `<div style="color:#6b7280;font-style:italic;">未发现明显${kind === 'price' ? '价格/1L/电解质' : '库存/箱数'}线索，建议人工扫听。</div>`;
        }
        return clues.map(clue => {
            const normalizedText = clue.normalized === clue.raw ? '' : ` | ${clue.normalized}`;
            const title = [
                `原句：${clue.raw}`,
                normalizedText ? `归一化：${clue.normalized}` : '',
                `原因：${clue.reason}`,
                clue.context.length > 1 ? `上下文：${clue.context.join(' / ')}` : '',
                clue.answers && clue.answers.length ? `后续回答：${clue.answers.map(x => x.raw).join(' / ')}` : ''
            ].filter(Boolean).join('\n');
            const questionText = sttEscapeHtml((clue.normalized || clue.raw).replace(/\s+/g, ' '));
            const answerText = clue.answers && clue.answers.length
                ? clue.answers.map(answer => sttEscapeHtml((answer.normalized || answer.raw).replace(/\s+/g, ' '))).join(' / ')
                : '';
            const lineText = answerText
                ? `<span style="color:#64748b;font-weight:600;">问：</span>${questionText}<span style="color:#64748b;font-weight:600;margin-left:6px;">答：</span>${answerText}`
                : questionText;
            const canSeek = clue.hasReliableTime || clue.hasEstimatedTime;
            const timeTitle = clue.hasEstimatedTime ? '按整段文本和音频时长估算的位置，可用于粗略跳转' : '跳到该字幕附近播放';
            const timeLabel = clue.hasEstimatedTime ? `约${sttFormatTime(clue.start)}` : sttFormatTime(clue.start);
            const timeButton = canSeek
                ? `<button class="sj-stt-seek-btn" title="${timeTitle}" data-time="${Math.max(0, clue.start - 2).toFixed(1)}" data-audio="${sttEscapeHtml(clue.audioUrl || '')}" style="background:rgba(15,23,42,0.08);border:1px solid rgba(15,23,42,0.12);border-radius:3px;color:#475569;font-size:10px;padding:0 4px;cursor:pointer;white-space:nowrap;line-height:16px;">${timeLabel}</button>`
                : `<span title="该线索来自无逐句时间戳的文本，无法精确跳转" style="background:rgba(15,23,42,0.05);border:1px solid rgba(15,23,42,0.08);border-radius:3px;color:#94a3b8;font-size:10px;padding:0 4px;white-space:nowrap;line-height:16px;">无时间</span>`;
            return `
                <div class="sj-stt-clue-card" title="${sttEscapeHtml(title)}" style="display:flex;align-items:flex-start;gap:5px;background:${bg};border-left:2px solid ${color};border-radius:3px;padding:3px 5px;margin-top:2px;min-height:18px;max-width:100%;">
                    <span style="color:${color};font-weight:700;white-space:nowrap;font-size:10.5px;line-height:18px;">${clue.confidence}</span>
                    <span style="color:#475569;flex:1;white-space:normal;overflow-wrap:anywhere;line-height:18px;">${lineText}</span>
                    ${timeButton}
                </div>
            `;
        }).join('');
    }

    function sttBindClueSeekButtons(container) {
        if (!container || container.dataset.sjSeekBound === 'true') return;
        container.dataset.sjSeekBound = 'true';
        container.addEventListener('click', async (e) => {
            const btn = e.target.closest('.sj-stt-seek-btn');
            if (!btn) return;
            let audio = document.querySelector('.el-dialog audio, .el-dialog__wrapper audio, audio');
            if (!audio) {
                const targetUrl = btn.dataset.audio || '';
                const cleanName = targetUrl.split('/').pop().split('?')[0];
                const audioLinks = Array.from(document.querySelectorAll('a[href*=".mp3"], a[href*=".m4a"], a[href*=".wav"], a[href*="sjaudiopub.slicejobs.com"]'));
                const link = audioLinks.find(a => cleanName && (a.href.includes(cleanName) || a.textContent.includes(cleanName))) || audioLinks[0];
                if (link) {
                    autoReviewClickEl(link);
                    for (let i = 0; i < 80; i++) {
                        await autoReviewSleep(50);
                        audio = document.querySelector('.el-dialog audio, .el-dialog__wrapper audio, audio');
                        if (audio) break;
                    }
                }
            }
            if (!audio) {
                autoReviewToast('未找到音频播放器，也没找到可点击的音频链接', true);
                return;
            }
            const targetTime = parseFloat(btn.dataset.time || '0');
            audio.currentTime = Math.max(0, targetTime);
            audio.play().catch(() => {});
        });
    }

    // 智能解析 API 返回结果，支持 JSON 文本、SRT 字幕和纯文本格式，并自动进行清洗
    function parseApiResponse(result, duration) {
        if (!result) return [];
        const trimmed = result.trim();
        if (!trimmed) return [];

        let rawSegs = [];
        // 1. 如果是 JSON 格式 (SiliconFlow 或 Groq 接口返回通常是 {"text": "..."})
        if (trimmed.startsWith('{')) {
            try {
                const data = JSON.parse(trimmed);
                if (data.segments && Array.isArray(data.segments)) {
                    rawSegs = data.segments.map(s => sttSegmentFromObject(s, duration)).filter(Boolean);
                } else if (data.chunks && Array.isArray(data.chunks)) {
                    rawSegs = data.chunks.map(s => sttSegmentFromObject(s, duration)).filter(Boolean);
                } else if (data.words && Array.isArray(data.words)) {
                    rawSegs = data.words.map(s => sttSegmentFromObject(s, duration)).filter(Boolean);
                } else if (data.text) {
                    rawSegs = [{ start: 0, end: duration || 0, text: data.text.trim(), timeUnreliable: true }];
                }
            } catch (e) {
                console.warn('[STT] Failed to parse API result as JSON:', e);
            }
        }
        // 2. 如果包含 SRT 特征，尝试作为 SRT 解析
        else if (trimmed.includes('-->')) {
            const srtSegs = parseSrt(trimmed);
            if (srtSegs && srtSegs.length > 0) {
                rawSegs = srtSegs;
            }
        }
        // 3. 回退为纯文本格式
        else {
            rawSegs = [{ start: 0, end: duration || 0, text: trimmed, timeUnreliable: true }];
        }

        // 统一对所有段落进行文本清理与去噪
        const cleanedSegs = [];
        for (const seg of rawSegs) {
            const txt = seg.text.trim();
            if (!txt) continue;

            // 过滤幻觉段落
            if (sttIsHallucination(txt)) {
                console.log('[STT] 过滤整个幻觉段落:', txt);
                continue;
            }

            // 连续重复段落去重
            if (cleanedSegs.length > 0) {
                const prevTxt = cleanedSegs[cleanedSegs.length - 1].text.trim();
                const prevClean = prevTxt.replace(/[，。？！、\s\n；;]+/g, '');
                const currClean = txt.replace(/[，。？！、\s\n；;]+/g, '');
                if (prevClean === currClean) {
                    console.log('[STT] 过滤重复段落:', txt);
                    continue;
                }
            }

            // 清洗段落内可能存在的极短噪声
            const cleanedText = sttCleanText(txt);
            if (cleanedText) {
                cleanedSegs.push({
                    ...seg,
                    text: sttEnsureSentencePunctuation(cleanedText)
                });
            }
        }
        return cleanedSegs;
    }

    async function sttProcess(audio, dialogBody, forceAi) {
        const src = audio && audio.src;
        if (!src) return;

        const bar = sttGetStatusBar(dialogBody);

        if (!forceAi && !sttIsAiEnabled()) {
            if (await sttWaitAndUseNativeSubtitlesLenient(audio, dialogBody, bar, 'ai-disabled-lenient')) return;
            sttRenderAiDisabled(bar, audio, dialogBody);
            return;
        }

        if (!forceAi) {
            if (await sttWaitAndUseNativeSubtitles(audio, dialogBody, bar, 'before-ai')) return;
        }

        // 原生字幕必须先于历史 AI 缓存判断，避免旧的错误 AI 字幕抢先覆盖页面字幕。
        const cached = (!forceAi && !sttIsAiEnabled()) ? null : sttReadCache(src);
        if (cached) {
            if (sttHasUsefulBusinessSignal(cached)) {
                replaceNativeSubtitles(cached, src);
                sttRenderSuccess(bar, dialogBody, cached, audio);
                return;
            }
            sessionStorage.removeItem(STT_CACHE_PREFIX + src);
            console.warn('[STT] Cached transcript looks unreliable, clearing and retrying:', src);
        }

        if (!sttHasAnyProviderKey()) { sttRenderKeyPrompt(bar, audio, dialogBody); return; }

        try {
            const arrayBuffer = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: src,
                    responseType: 'arraybuffer',
                    onload:  r => resolve(r.response),
                    onerror: reject,
                    ontimeout: reject
                });
            });

            const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
            const providers = sttChooseProviders(audio, blob, src);
            if (providers.length === 0) { sttRenderKeyPrompt(bar, audio, dialogBody); return; }

            console.log('[STT] Providers:', providers.map(p => p.label).join(' -> '), 'audio size:', (blob.size / 1024 / 1024).toFixed(2), 'MB', 'duration:', audio.duration || sttParseDurationFromSrc(src) || 0);
            const result = await sttTranscribeWithFallback(providers, blob, (provider) => {
                sttRenderLoading(bar, provider);
            });

            // 接口返回后重新检查 AI 开关状态，若已被用户关闭则直接丢弃
            if (!sttIsAiEnabled()) {
                console.log('[STT] AI was disabled mid-flight, discarding results.');
                if (sttTryUseNativeSubtitlesFallback(audio, dialogBody, bar, 'ai-disabled-midflight')) return;
                sttRenderAiDisabled(bar, audio, dialogBody);
                return;
            }

            const audioDuration = Number(audio.duration) || sttParseDurationFromSrc(src) || 0;
            let segs = parseApiResponse(result, audioDuration);
            if (!segs || segs.length === 0) {
                segs = [{ start: 0, end: audioDuration, text: '(未识别出有效语音)', timeUnreliable: true }];
            }

            if (sttHasUsefulBusinessSignal(segs)) {
                sttWriteCache(src, segs);
                replaceNativeSubtitles(segs, src);
                sttRenderSuccess(bar, dialogBody, segs, audio);
            } else {
                // AI结果无业务信号：先严格匹配原生字幕，再宽松兜底（有字幕就展示），最后才报错
                if (sttTryUseNativeSubtitles(audio, dialogBody, bar, 'ai-no-business-signal')) return;
                if (sttTryUseNativeSubtitlesFallback(audio, dialogBody, bar, 'ai-hallucination-lenient')) return;
                sttRenderError(bar, 'AI结果疑似幻觉，未缓存。建议听原音或稍后重试。');
            }

        } catch (e) {
            console.error('[STT]', e);
            // AI报错：先严格匹配原生字幕，再宽松兜底（有字幕就展示，比报错好）
            if (sttTryUseNativeSubtitles(audio, dialogBody, bar, 'ai-error')) return;
            if (sttTryUseNativeSubtitlesFallback(audio, dialogBody, bar, 'ai-error-lenient')) return;
            sttRenderError(bar, e.message);
        }
    }
    function sttFindContextPanels() {
        const reviews = document.querySelectorAll('.answer--review');
        let q10Panel = null;
        let q15Panel = null;

        for (const review of reviews) {
            let searchText = '';
            let temp = review;
            for (let i = 0; i < 4; i++) {
                if (temp) {
                    searchText += ' ' + (temp.textContent || '');
                    temp = temp.parentElement;
                }
            }

            const hasQ10 = searchText.includes('Q10') || searchText.includes('q10');
            const hasQ15 = searchText.includes('Q15') || searchText.includes('q15');
            if (hasQ10 && !q10Panel) q10Panel = review;
            if (hasQ15 && !q15Panel) q15Panel = review;
        }

        return { q10Panel, q15Panel };
    }

    function sttRenderContextTipBox(panel, id, title, htmlContent) {
        if (!panel) return;
        try {
            let tipBox = panel.querySelector('#' + id);
            if (!tipBox) {
                tipBox = document.createElement('div');
                tipBox.id = id;
                tipBox.className = 'sj-stt-tip-box';
                const insertionTarget = panel.querySelector('textarea, input, .el-textarea, .el-input, .answer-input, .el-form-item') || panel;
                if (insertionTarget && insertionTarget !== panel) {
                    insertionTarget.parentNode.insertBefore(tipBox, insertionTarget);
                } else {
                    panel.appendChild(tipBox);
                }
            }
            tipBox.innerHTML = `<span style="color:#64748b;font-weight:600;font-size:11px;">${title}</span>${htmlContent}`;
            sttBindClueSeekButtons(tipBox);
        } catch (err) {
            console.error('[STT] Error rendering tip box:', err);
        }
    }

    function sttRenderContextStatus(message) {
        const { q10Panel, q15Panel } = sttFindContextPanels();
        const html = `<div style="color:#64748b;font-size:11px;margin-top:2px;">${sttEscapeHtml(message)}</div>`;
        sttRenderContextTipBox(q10Panel, 'sj-stt-tip-q10', 'AI价格:', html);
        sttRenderContextTipBox(q15Panel, 'sj-stt-tip-q15', 'AI库存:', html);
    }

    // 联动渲染 Q10 与 Q15 下方的 AI 字幕重点提示卡片
    function sttUpdateContextualTips() {
        // 确保至少有一个转写成功的音频内容，否则暂不渲染
        let hasAnyTranscripts = false;
        for (const url in sttCurrentOrderTranscripts) {
            const segs = sttCurrentOrderTranscripts[url];
            if (segs && segs.length > 0) {
                hasAnyTranscripts = true;
                break;
            }
        }
        if (!hasAnyTranscripts) return;

        const { q10Panel, q15Panel } = sttFindContextPanels();

        // 如果面板尚未被 Vue 绘制出来，则跳过本次，等待轮询
        if (!q10Panel && !q15Panel) return;

        const priceClues = sttBuildBusinessClues('price');
        const stockClues = sttBuildBusinessClues('stock');
        const highlightedPriceHtml = sttFormatBusinessClues('price', priceClues);
        const highlightedStockHtml = sttFormatBusinessClues('stock', stockClues);

        sttRenderContextTipBox(q10Panel, 'sj-stt-tip-q10', '字幕价格:', highlightedPriceHtml);
        sttRenderContextTipBox(q15Panel, 'sj-stt-tip-q15', '字幕库存:', highlightedStockHtml);
    }

    // 清空两个提示面板
    function sttClearContextualTips() {
        const t1 = document.getElementById('sj-stt-tip-q10');
        if (t1) t1.remove();
        const t2 = document.getElementById('sj-stt-tip-q15');
        if (t2) t2.remove();
    }

    // 从审单页面（不依赖弹窗打开）收集所有音频文件 URL
    // 策略：使用递归对象扫描器深挖 Vue 实例、props、Vuex 状态以及组件树，彻底避免 JSON.stringify 循环引用报错
    function sttCollectAudioUrls() {
        const urls = new Set();
        const AUDIO_CDN_RE = /https?:\/\/sjaudiopub\.slicejobs\.com\/[^"'\s<>\\\]]+/g;

        // 1. 标准 DOM 选择器（做个兜底）
        document.querySelectorAll('audio[src], audio source[src]').forEach(el => {
            if (el.src) urls.add(el.src);
        });
        document.querySelectorAll('a[href]').forEach(el => {
            if (/\.(mp3|m4a|wav|aac)(\?|$)/i.test(el.href)) urls.add(el.href);
        });

        // 2. 深度且安全的 JS 对象属性扫描器（规避 circular reference 循环引用导致的 JSON.stringify 崩溃）
        function safeScanObject(obj, visited = new Set(), depth = 0) {
            if (!obj || depth > 8) return;
            if (typeof obj === 'string') {
                if (obj.includes('sjaudiopub.slicejobs.com')) {
                    const matches = obj.match(AUDIO_CDN_RE);
                    if (matches) {
                        matches.forEach(u => {
                            urls.add(u.replace(/[\\]+$/, '').split('"')[0]);
                        });
                    }
                }
                return;
            }
            if (typeof obj !== 'object') return;
            if (visited.has(obj)) return;
            visited.add(obj);

            if (Array.isArray(obj)) {
                for (let i = 0; i < obj.length; i++) {
                    safeScanObject(obj[i], visited, depth + 1);
                }
                return;
            }

            try {
                for (const key in obj) {
                    if (Object.prototype.hasOwnProperty.call(obj, key)) {
                        if (key.startsWith('_') && key !== '_data' && key !== '_props') continue;
                        if (['$el', '$parent', '$root', 'constructor', 'sys'].includes(key)) continue;
                        safeScanObject(obj[key], visited, depth + 1);
                    }
                }
            } catch {}
        }

        // 3. 递归扫描 Vue 组件树
        function scanVueComponent(vm, visitedComponents = new Set(), visitedObjects = new Set()) {
            if (!vm || visitedComponents.has(vm)) return;
            visitedComponents.add(vm);

            // 扫描当前组件实例的成员（自动扫描 $data, _data, _props 等）
            safeScanObject(vm, visitedObjects, 0);

            // 扫描 Vuex store state (如果挂载在当前组件或根组件上)
            if (vm.$store && vm.$store.state) {
                safeScanObject(vm.$store.state, visitedObjects, 0);
            }

            // 递归扫描子组件
            if (vm.$children && Array.isArray(vm.$children)) {
                for (const child of vm.$children) {
                    scanVueComponent(child, visitedComponents, visitedObjects);
                }
            }
        }

        // 4. 获取页面中所有 Vue 实例并进行深度扫描
        const visitedComponents = new Set();
        const visitedObjects = new Set();

        const seedEls = document.querySelectorAll('*');
        for (const el of seedEls) {
            if (el.__vue__) {
                let rootVm = el.__vue__;
                while (rootVm.$parent) {
                    rootVm = rootVm.$parent;
                }
                scanVueComponent(rootVm, visitedComponents, visitedObjects);
            }
        }

        // 5. 兜底：innerHTML 全文匹配
        try {
            const raw = document.documentElement.innerHTML;
            (raw.match(AUDIO_CDN_RE) || []).forEach(u => {
                urls.add(u.replace(/["'\\<>]+.*$/, ''));
            });
        } catch {}

        const result = Array.from(urls).filter(u => u.startsWith('http'));
        console.log('[STT AutoScan] Deep collected audio URLs:', result);
        return result;
    }

    // 后台静默下载 + API 识别某个 URL，并把结果写入缓存并更新 Q10/Q15 提示卡片
    const sttSilentInFlight = new Set();
    async function sttSilentProcess(url) {
        if (!url) return;

        const httpsUrl = url.replace(/^http:\/\//i, 'https://');
        // 后台只有在确实拿到原生字幕后才有资格判断是否需要 AI。
        // 如果字幕尚未加载（常见于录音弹窗还没打开），就延后到前台 sttProcess，不能把“没抓到”当成“没关键词”。
        if (await sttWaitAndUseNativeSubtitlesByUrl(url, 'before-background-ai')) return;
        const availableNativeSegs = sttGetNativeSubtitleSegmentsByUrl(url);
        if (!availableNativeSegs || availableNativeSegs.length === 0) {
            console.log('[STT AutoScan] Native subtitles are not available yet; deferring AI until the audio dialog is opened:', url);
            return;
        }

        const cached = sttReadCache(httpsUrl) || sttReadCache(url);
        if (cached) {
            if (sttHasUsefulBusinessSignal(cached)) {
                sttCurrentOrderTranscripts[url] = cached;
                sttUpdateContextualTips();
                return;
            } else {
                sessionStorage.removeItem(STT_CACHE_PREFIX + httpsUrl);
                sessionStorage.removeItem(STT_CACHE_PREFIX + url);
            }
        }

        if (!sttIsAiEnabled()) return;
        if (!sttHasAnyProviderKey()) return;
        if (sttSilentInFlight.has(httpsUrl)) return;

        sttSilentInFlight.add(httpsUrl);
        try {
            const arrayBuffer = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: httpsUrl,
                    responseType: 'arraybuffer',
                    onload:  r => resolve(r.response),
                    onerror: reject,
                    ontimeout: reject
                });
            });

            const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
            const duration = await sttGetAudioDurationFromBlob(blob);
            console.log('[STT AutoScan] 真实音频时长:', duration.toFixed(1), '秒');
            const providers = sttChooseProviders({ duration }, blob, url);
            if (providers.length === 0) return;

            console.log('[STT AutoScan] Providers:', providers.map(p => p.label).join(' -> '), 'audio size:', (blob.size / 1024 / 1024).toFixed(2), 'MB');
            sttRenderContextStatus(`AI后台识别中：${providers.map(p => p.label).join(' -> ')}`);
            const result = await sttTranscribeWithFallback(providers, blob, (provider) => {
                sttRenderContextStatus(`AI后台识别中：${provider.label}`);
            });

            const transcriptDuration = duration || sttParseDurationFromSrc(url) || 0;
            let segs = parseApiResponse(result, transcriptDuration);
            if (!segs || segs.length === 0) {
                segs = [{ start: 0, end: transcriptDuration, text: '(未识别出有效语音)', timeUnreliable: true }];
            }

            if (sttHasUsefulBusinessSignal(segs)) {
                sttWriteCache(httpsUrl, segs);
                sttWriteCache(url, segs);
                sttCurrentOrderTranscripts[url] = segs;
                sttUpdateContextualTips();
            } else {
                if (sttTryUseNativeSubtitlesByUrl(url, 'background-ai-no-business-signal')) return;
                sttRenderContextStatus('AI已识别，但未发现可靠的价格/库存线索');
                console.warn('[STT AutoScan] AI result looks unreliable, not caching:', url);
            }
        } catch (e) {
            if (sttTryUseNativeSubtitlesByUrl(url, 'background-ai-error')) return;
            sttRenderContextStatus(`AI后台识别失败：${e.message}`);
            console.warn('[STT AutoScan] Failed for', url, e.message);
        } finally {
            sttSilentInFlight.delete(httpsUrl);
        }
    }

    // 主扫描入口：进入审单页面后自动找音频并后台识别
    let sttAutoScanDoneUrl = null;
    async function sttAutoScanPage() {
        if (!location.pathname.startsWith('/order/review')) return;
        if (!document.querySelector('.answer--review')) return;

        const currentUrl = location.href;
        if (sttAutoScanDoneUrl === currentUrl) return;

        const urls = sttCollectAudioUrls();
        if (urls.length === 0) {
            return; // 暂不标记已完成，让定时器下一次重新检测
        }

        sttAutoScanDoneUrl = currentUrl;
        console.log(`[STT AutoScan] Found ${urls.length} audio URL(s), ${sttIsAiEnabled() ? 'starting background recognition' : 'checking cached transcripts only'}...`, urls);

        for (const url of urls) {
            await sttSilentProcess(url);
        }

        console.log('[STT AutoScan] Background audio pass finished.');
    }


    let sttLastAudioSrc = null;
    function sttInit() {
        if (!location.pathname.startsWith('/order/review')) {
            const p = document.getElementById('sj-stt-status');
            if (p) p.remove();
            if (sttObserver) {
                sttObserver.disconnect();
                sttObserver = null;
            }
            sttLastAudioSrc = null;
            sttClearContextualTips();
            return;
        }

        const audio = document.querySelector('.el-dialog audio, .el-dialog__wrapper audio');
        if (!audio || !audio.src) {
            const p = document.getElementById('sj-stt-status');
            if (p) p.remove();
            if (sttObserver) {
                sttObserver.disconnect();
                sttObserver = null;
            }
            sttLastAudioSrc = null;
            return;
        }

        if (audio.src === sttLastAudioSrc) return;
        sttClearContextualTips();
        if (sttObserver) {
            sttObserver.disconnect();
            sttObserver = null;
        }
        const lyricUl = document.querySelector('.audio-player-lyric ul');
        if (lyricUl && lyricUl.dataset.sjSttSource && lyricUl.dataset.sjSttSource !== sttAudioKey(audio.src)) {
            delete lyricUl.dataset.sjSttSource;
            delete lyricUl.dataset.sjSttMode;
        }
        sttLastAudioSrc = audio.src;

        const dialogBody =
            audio.closest('.el-dialog__body') ||
            audio.closest('.el-dialog') ||
            audio.closest('.el-dialog__wrapper');
        if (!dialogBody) return;

        sttProcess(audio, dialogBody);
    }

    // 自动折叠不需要做（或由一键通过自动判定）的题目卡片
    function autoReviewCollapseUnneeded() {
        const reviews = document.querySelectorAll('.answer--review');
        if (reviews.length === 0) return;

        // 寻找包含该题目的整张卡片以及题号
        function findQuestionCard(review) {
            let temp = review.parentElement; // 从父级开始向上找，避免直接在 review 内部误判
            while (temp && temp !== document.body) {
                // 寻找标题元素
                const titleEl = temp.querySelector('.answer-title, h4, h3, .el-form-item__label, .answer-question-title, [class*="title"], [class*="header"]');
                if (titleEl) {
                    const txt = titleEl.textContent.trim();
                    const match = txt.match(/^[qQ](\d+)/);
                    if (match) {
                        return {
                            card: temp,
                            qNum: 'Q' + match[1],
                            titleEl: titleEl
                        };
                    }
                }
                temp = temp.parentElement;
            }
            return null;
        }

        reviews.forEach((review) => {
            const cardInfo = findQuestionCard(review);
            if (!cardInfo) return;

            const { card, qNum, titleEl } = cardInfo;
            let shouldCollapse = false;

            if (['Q1', 'Q2', 'Q6', 'Q14', 'Q17'].includes(qNum)) {
                // 这些题目默认折叠（除非用户手动展开了）
                shouldCollapse = !sttManuallyExpanded.has(qNum);
            } else if (qNum === 'Q13') {
                // Q13 根据自身的选项决定是否折叠：
                // 如果勾选了“无脉动冰柜”、“无”、“没有”等，并且未手动展开，则折叠
                let q13HasNoFreezer = false;
                const checkedOption = card.querySelector('.el-radio.is-checked, .el-checkbox.is-checked, input:checked');
                if (checkedOption) {
                    const txt = checkedOption.textContent.trim() || checkedOption.value || '';
                    if (txt.includes('无') || txt.includes('没有') || txt.includes('否')) {
                        q13HasNoFreezer = true;
                    }
                }
                shouldCollapse = q13HasNoFreezer && !sttManuallyExpanded.has(qNum);
            }

            // 绑定点击交互逻辑 (仅限一次，绑定在整张卡片上)
            if (!card.dataset.sjCollapseBound) {
                card.dataset.sjCollapseBound = 'true';
                card.addEventListener('click', (e) => {
                    // 折叠状态下，点击卡片任意区域都触发展开
                    if (card.classList.contains('sj-collapsed-card')) {
                        card.classList.remove('sj-collapsed-card');
                        sttManuallyExpanded.add(qNum);
                        const toggleBtn = card.querySelector('.sj-collapse-toggle-btn');
                        if (toggleBtn) toggleBtn.innerHTML = ` ↔️ 收起`;
                        e.stopPropagation();
                        e.preventDefault();
                    } else {
                        // 展开状态下，只有点击“收起”按钮才折叠回去
                        if (e.target.classList.contains('sj-collapse-toggle-btn')) {
                            card.classList.add('sj-collapsed-card');
                            sttManuallyExpanded.delete(qNum);
                            const toggleBtn = card.querySelector('.sj-collapse-toggle-btn');
                            if (toggleBtn) toggleBtn.innerHTML = ` ↔️ 展开`;
                            e.stopPropagation();
                            e.preventDefault();
                        }
                    }
                });
            }

            if (shouldCollapse) {
                if (!card.classList.contains('sj-collapsed-card')) {
                    card.classList.add('sj-collapsed-card');
                }
                let toggleBtn = card.querySelector('.sj-collapse-toggle-btn');
                if (!toggleBtn) {
                    toggleBtn = document.createElement('span');
                    toggleBtn.className = 'sj-collapse-toggle-btn';
                    toggleBtn.style.color = '#409EFF';
                    toggleBtn.style.cursor = 'pointer';
                    toggleBtn.style.marginLeft = '10px';
                    toggleBtn.style.fontWeight = 'bold';
                    toggleBtn.style.fontSize = '12px';
                    
                    titleEl.appendChild(toggleBtn);
                }
                toggleBtn.innerHTML = ` ↔️ 展开`;
            } else {
                if (card.classList.contains('sj-collapsed-card')) {
                    card.classList.remove('sj-collapsed-card');
                }
                let toggleBtn = card.querySelector('.sj-collapse-toggle-btn');
                if (toggleBtn) {
                    toggleBtn.innerHTML = ` ↔️ 收起`;
                }
            }
        });
    }

    // 初始化入口（每次由 init 定时检查，无额外并发定时器）
    function autoReviewInit() {
        // 取消占有后页面可能被网站带回列表；无论当前路由是什么，都继续完成下一单领取。
        sjHandlePendingSkipNavigation();
        if (!location.pathname.startsWith('/order/review')) {
            const btn = document.getElementById('sj-auto-review-btn');
            if (btn) btn.remove();
            const openBtn = document.getElementById('sj-open-recording-btn');
            if (openBtn) openBtn.remove();
            const controlPanel = document.getElementById('sj-control-panel');
            if (controlPanel) controlPanel.remove();
            const skipBtn = document.getElementById('sj-skip-order-btn');
            if (skipBtn) skipBtn.remove();
            sjRecordingAutoOpenOrderKey = '';
            sttCurrentOrderTranscripts = {};
            sttLastLocationHref = null;
            return;
        }

        const currentUrl = location.href;
        if (sttLastLocationHref !== currentUrl) {
            sttLastLocationHref = currentUrl;
            sttCurrentOrderTranscripts = {};
            sttAutoScanDoneUrl = null;
            sttManuallyExpanded.clear(); // 切换新工单时重置手动展开记录
        }

        // 直接同步检测题目面板是否存在且一键通过按钮尚未渲染，满足才创建
        if (document.querySelector('.answer--review')) {
            if (!document.getElementById('sj-auto-review-btn')) {
                autoReviewCreatePanel();
            }
            // 自动在后台异步扫描并识别所有音频
            sjRecordingCreateOpenButton();
            sjRecordingAutoOpenForOrder();
            sttAutoScanPage();

            // 持续恢复 AI 提示框渲染 (防 Vue 响应式重绘擦除)
            sttUpdateContextualTips();

            // 自动折叠非必须审核的题目卡片
            autoReviewCollapseUnneeded();

            // 单槽预取：进入新订单后清空已消费槽，再补充且只补充一单。
            const match = location.pathname.match(/\/order\/review\/(\d+)/);
            if (match) {
                const currentOrderId = match[1];
                sjFinalizePrefetchSlotForCurrentOrder(currentOrderId);
                const projectId = sjGetActiveProjectId();
                if (projectId) {
                    sjPrefetchNextOrder(currentOrderId, projectId);
                }
            }

            // 网络拦截未命中时，以网站成功弹窗兜底。
            if (typeof autoReviewGetVisibleSuccessDialog === 'function' && autoReviewGetVisibleSuccessDialog()) {
                sjTriggerPrefetchJump('success-dialog-fallback');
            }
        }

        // AI 字幕识别
        sttInit();
    }

    // 初始化按钮与面板
    const init = () => {


// ===== stats.js =====
﻿        if (typeof autoReviewInit === 'function') {
            autoReviewInit();
        }

        if (document.getElementById('sj-stats-float-btn')) return;

        // 创建悬浮球/HUD
        const btn = document.createElement('div');
        btn.id = 'sj-stats-float-btn';
        btn.title = '审核数据统计助手 (Alt + S) [双击展开/折叠迷你状态栏]';

        const initialMode = localStorage.getItem('sj_stats_hud_mode') || 'min';
        btn.className = initialMode === 'exp' ? 'sj-hud-exp' : 'sj-hud-min';

        if (initialMode === 'exp') {
            btn.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px; width: 100%; height: 100%; justify-content: center; font-family: 'Plus Jakarta Sans', sans-serif; opacity: 0.5;">
                    <svg viewBox="0 0 24 24" style="width: 15px; height: 15px; fill: currentColor; flex-shrink: 0; margin-top: 1px;">
                        <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/>
                    </svg>
                    <span class="sj-hud-text" style="font-size: 11.5px; white-space: nowrap;">数据加载中...</span>
                </div>
            `;
        } else {
            btn.innerHTML = `
                <svg viewBox="0 0 24 24">
                    <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/>
                </svg>
                <div id="sj-stats-badge"></div>
            `;
        }

        // 读取持久化位置坐标
        const savedX = localStorage.getItem('sj_stats_btn_x');
        const savedY = localStorage.getItem('sj_stats_btn_y');
        if (savedX && savedY) {
            btn.style.right = 'auto';
            btn.style.bottom = 'auto';
            btn.style.left = savedX + 'px';
            btn.style.top = savedY + 'px';
        }

        document.body.appendChild(btn);
        initFloatBadge();

        // 拖拽逻辑实现 (v2.4)
        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let initialLeft = 0;
        let initialTop = 0;

        btn.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return; // 仅限鼠标左键拖拽
            isDragging = false;
            startX = e.clientX;
            startY = e.clientY;

            const rect = btn.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;

            btn.classList.add('sj-dragging');
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            e.preventDefault(); // 阻止默认的文本拖选
        });

        const onMouseMove = (e) => {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            if (!isDragging && Math.sqrt(dx * dx + dy * dy) > 5) {
                isDragging = true;
            }

            if (isDragging) {
                let newLeft = initialLeft + dx;
                let newTop = initialTop + dy;

                const rect = btn.getBoundingClientRect();
                const btnWidth = rect.width;
                const btnHeight = rect.height;
                const maxLeft = window.innerWidth - btnWidth;
                const maxTop = window.innerHeight - btnHeight;

                newLeft = Math.max(0, Math.min(newLeft, maxLeft));
                newTop = Math.max(0, Math.min(newTop, maxTop));

                btn.style.right = 'auto';
                btn.style.bottom = 'auto';
                btn.style.left = newLeft + 'px';
                btn.style.top = newTop + 'px';
            }
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            btn.classList.remove('sj-dragging');

            if (isDragging) {
                const rect = btn.getBoundingClientRect();
                localStorage.setItem('sj_stats_btn_x', Math.round(rect.left));
                localStorage.setItem('sj_stats_btn_y', Math.round(rect.top));
            }
        };

        // 创建模态框
        const overlay = document.createElement('div');
        overlay.id = 'sj-stats-modal-overlay';
        overlay.innerHTML = `
            <div id="sj-stats-card">
                <div class="sj-card-header">
                    <h3 class="sj-card-title" style="display: flex; align-items: center; gap: 8px;">
                        <svg viewBox="0 0 24 24" style="width: 18px; height: 18px; fill: none; stroke: url(#sj-title-grad); stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round;"><defs><linearGradient id="sj-title-grad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#ffffff"/><stop offset="100%" stop-color="#3b82f6"/></linearGradient></defs><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="9" x2="15" y2="9"></line><line x1="9" y1="13" x2="15" y2="13"></line><line x1="9" y1="17" x2="13" y2="17"></line></svg>
                        审核效率统计助手
                    </h3>
                    <button class="sj-card-close" id="sj-stats-close-btn">
                        <svg viewBox="0 0 24 24">
                            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                        </svg>
                    </button>
                </div>
                <!-- 日期切换栏 -->
                <div class="sj-date-picker-bar">
                    <button class="sj-date-btn" id="sj-date-prev">
                        <svg viewBox="0 0 24 24"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
                        前一天
                    </button>
                    <input type="date" class="sj-date-input" id="sj-date-select">
                    <button class="sj-date-btn" id="sj-date-next">
                        后一天
                        <svg viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
                    </button>
                    <button class="sj-date-btn" id="sj-refresh-btn" title="刷新当前数据" style="margin-left: auto; border-color: rgba(255, 255, 255, 0.15); color: #cbd5e1;">
                        <svg viewBox="0 0 24 24" style="width:14px; height:14px; fill:none; stroke:currentColor; stroke-width:2.5; stroke-linecap:round; stroke-linejoin:round; margin-right:4px;"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
                        刷新
                    </button>
                    <button class="sj-date-btn" id="sj-export-csv" title="导出数据为CSV" style="border-color: rgba(59, 130, 246, 0.25); color: #60a5fa;">
                        <svg viewBox="0 0 24 24" style="width:14px; height:14px; fill:none; stroke:currentColor; stroke-width:2.5; stroke-linecap:round; stroke-linejoin:round; margin-right:4px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                        导出数据
                    </button>
                </div>
                <!-- 选项卡切换 (v1.8新增企业级设计) -->
                <div class="sj-tabs-header" style="display: flex; gap: 24px; border-bottom: 1px solid rgba(255, 255, 255, 0.06); padding: 0 24px; background: rgba(255, 255, 255, 0.005); height: 40px; align-items: center;">
                    <div class="sj-tab-item active" id="sj-tab-daily">日效能分析</div>
                    <div class="sj-tab-item" id="sj-tab-weekly">近7日趋势</div>
                </div>
                <div class="sj-card-body" id="sj-stats-content">
                    <!-- 动态加载内容 -->
                </div>
                <!-- 键盘快捷键指示底部 (v2.2新增) -->
                <div class="sj-card-footer" style="padding: 10px 24px; border-top: 1px solid rgba(255, 255, 255, 0.04); background: rgba(0, 0, 0, 0.2); font-size: 11px; color: #475569; display: flex; justify-content: space-between; align-items: center; user-select: none;">
                    <span>提示：按 <kbd style="background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 3px; padding: 1px 4px; font-family: inherit; font-size: 10px; color: #94a3b8;">Alt + S</kbd> 可快速开关此面板</span>
                    <span>按 <kbd style="background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 3px; padding: 1px 4px; font-family: inherit; font-size: 10px; color: #94a3b8;">Esc</kbd> 退出或取消目标编辑</span>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        // 初始化日期控件值
        const dateInput = document.getElementById('sj-date-select');
        dateInput.value = formatDate(currentDate);
        dateInput.max = formatDate(new Date());

        const closePanel = () => {
            overlay.classList.remove('active');
            stopAutoRefresh();
        };

        // 事件绑定
        // 事件绑定 (v2.8支持单双击分离)
        let clickTimeout = null;
        btn.addEventListener('click', (e) => {
            if (isDragging) {
                isDragging = false; // 重置拖动状态
                if (clickTimeout) {
                    clearTimeout(clickTimeout);
                    clickTimeout = null;
                }
                return;
            }
            if (clickTimeout) {
                clearTimeout(clickTimeout);
                clickTimeout = null;
                return; // 捕获到双击，放弃此次点击触发
            }
            clickTimeout = setTimeout(() => {
                clickTimeout = null;
                overlay.classList.add('active');
                loadStats();
                startAutoRefresh();
            }, 220); // 220ms延时以区分双击
        });

        btn.addEventListener('dblclick', (e) => {
            if (clickTimeout) {
                clearTimeout(clickTimeout);
                clickTimeout = null;
            }
            toggleHudMode();
        });
        document.getElementById('sj-stats-close-btn').addEventListener('click', closePanel);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                closePanel();
            }
        });
        // 键盘快捷键监听
        document.addEventListener('keydown', (e) => {
            // Esc 键关闭面板
            if (e.key === 'Escape' || e.key === 'Esc') {
                if (overlay.classList.contains('active')) {
                    closePanel();
                }
            }
            // Alt + S 组合键开关面板
            if (e.altKey && (e.key === 's' || e.key === 'S' || e.code === 'KeyS')) {
                e.preventDefault();
                if (overlay.classList.contains('active')) {
                    closePanel();
                } else {
                    overlay.classList.add('active');
                    loadStats();
                    startAutoRefresh();
                }
            }
            // Alt + A 组合键一键通过审核
            if (e.altKey && (e.key === 'a' || e.key === 'A' || e.code === 'KeyA')) {
                if (location.pathname.startsWith('/order/review')) {
                    e.preventDefault();
                    if (typeof autoReviewRunFullFlow === 'function') {
                        autoReviewRunFullFlow();
                    }
                }
            }
        });

        // 页面可见性监听 (自动挂起后台轮询以节约网络开销和避免拉黑)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                stopAutoRefresh();
            } else if (overlay.classList.contains('active')) {
                startAutoRefresh();
                // 重新可见且面板是打开的，立即拉取一次今日最新数据进行重绘
                const token = localStorage.getItem('token');
                const dateStr = formatDate(currentDate);
                const todayStr = formatDate(new Date());
                if (token && currentTab === 'daily' && dateStr === todayStr) {
                    delete queryCache[dateStr];
                    fetchRecordsForDate(token, dateStr).then(allRecords => {
                        const yestDate = new Date(currentDate);
                        yestDate.setDate(yestDate.getDate() - 1);
                        return fetchRecordsForDate(token, formatDate(yestDate)).then(yesterdayRecords => {
                            const activeOverlay = document.getElementById('sj-stats-modal-overlay');
                            if (activeOverlay && activeOverlay.classList.contains('active')) {
                                renderStats(allRecords, yesterdayRecords);
                            }
                        });
                    }).catch(err => console.warn("Visibility resume refresh failed:", err));
                }
            }
        });

        // 日期切换事件
        document.getElementById('sj-date-prev').addEventListener('click', () => {
            currentDate.setDate(currentDate.getDate() - 1);
            updateDateUI();
            loadStats();
        });
        document.getElementById('sj-date-next').addEventListener('click', () => {
            const today = new Date();
            if (formatDate(currentDate) === formatDate(today)) return;
            currentDate.setDate(currentDate.getDate() + 1);
            updateDateUI();
            loadStats();
        });
        dateInput.addEventListener('change', (e) => {
            const selectedDate = new Date(e.target.value);
            if (!isNaN(selectedDate.getTime())) {
                currentDate = selectedDate;
                updateDateUI();
                loadStats();
            }
        });

        // 选项卡切换事件绑定
        const tabDaily = document.getElementById('sj-tab-daily');
        const tabWeekly = document.getElementById('sj-tab-weekly');

        tabDaily.addEventListener('click', () => {
            if (currentTab === 'daily') return;
            currentTab = 'daily';
            tabDaily.className = 'sj-tab-item active';
            tabWeekly.className = 'sj-tab-item';
            loadStats();
        });

        tabWeekly.addEventListener('click', () => {
            if (currentTab === 'weekly') return;
            currentTab = 'weekly';
            tabWeekly.className = 'sj-tab-item active';
            tabDaily.className = 'sj-tab-item';
            loadStats();
        });

        // 绑定刷新事件
        const refreshBtn = document.getElementById('sj-refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                if (currentTab === 'daily') {
                    const dateStr = formatDate(currentDate);
                    delete queryCache[dateStr];
                    sessionStorage.removeItem(`sj_cache_records_${dateStr}`);
                    // 也删除昨天的缓存，以便重新获取昨日对照
                    const yestDate = new Date(currentDate);
                    yestDate.setDate(yestDate.getDate() - 1);
                    const yestDateStr = formatDate(yestDate);
                    delete queryCache[yestDateStr];
                    sessionStorage.removeItem(`sj_cache_records_${yestDateStr}`);
                } else {
                    const todayObj = new Date(currentDate);
                    for (let i = 0; i < 7; i++) {
                        const d = new Date(todayObj);
                        d.setDate(todayObj.getDate() - i);
                        const dStr = formatDate(d);
                        delete queryCache[dStr];
                        sessionStorage.removeItem(`sj_cache_records_${dStr}`);
                    }
                }
                loadStats();
            });
        }

        // 绑定数据导出事件 (支持分视图导出)
        const exportBtn = document.getElementById('sj-export-csv');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                if (currentTab === 'daily') {
                    if (!currentDayStats) {
                        alert("暂无当前日期的数据可导出！");
                        return;
                    }
                    const { dateStr, hourlyStats, hourlyReworkStats, totalCount, totalRework, totalAudits, speedPerHour, activeHours, observedCount, rejectedCount } = currentDayStats;
                    const target = getTargetForDate(dateStr);
                    const coreHours = [9, 10, 11, 13, 14, 15, 16, 17];
                    const extraHours = [];
                    for (let h = 0; h < 24; h++) {
                        if ((hourlyStats[h] || 0) > 0 || (hourlyReworkStats[h] || 0) > 0) {
                            if (!coreHours.includes(h)) {
                                extraHours.push(h);
                            }
                        }
                    }
                    const displayHours = [...coreHours, ...extraHours].sort((a, b) => a - b);

                    let csvContent = "\ufeff时间段,初审数量 (单),复审数量 (单),时间段备注\n";
                    displayHours.forEach(hour => {
                        let timeLabel = `${hour}-${hour + 1}点`;
                        let remark = "";
                        if (hour === 9) remark = "包含8点提前量";
                        if (hour === 11) remark = "包含12点午休量";
                        if (hour === 17) remark = "包含18点加班量";
                        csvContent += `"${timeLabel}","${hourlyStats[hour] || 0}","${hourlyReworkStats[hour] || 0}","${remark}"\n`;
                    });

                    csvContent += `"\n指标项目 (含单位)","指标数值"\n`;
                    csvContent += `"今日初审总量 (单)","${totalCount}"\n`;
                    csvContent += `"今日复审总量 (单)","${totalRework}"\n`;
                    csvContent += `"今日总审核量 (包含复审) (单)","${totalAudits}"\n`;
                    csvContent += `"今日退单 (单)","${rejectedCount || 0}"\n`;
                    csvContent += `"历史观测最大总量 (单)","${observedCount || totalAudits}"\n`;
                    csvContent += `"预设目标 (单)","${target}"\n`;
                    csvContent += `"目标达成率 (%)","${(totalCount / target * 100).toFixed(1)}"\n`;
                    csvContent += `"工作均速 (初审) (单/h)","${speedPerHour}"\n`;
                    csvContent += `"活跃工时 (小时)","${Number(activeHours).toFixed(1)}"\n`;

                    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement("a");
                    link.setAttribute("href", url);
                    link.setAttribute("download", `爱零工审核数据_${dateStr}.csv`);
                    link.style.visibility = 'hidden';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                } else {
                    if (!currentWeeklyStats) {
                        alert("暂无可用周数据导出！");
                        return;
                    }
                    const { dateList, weeklyData, totalWeeklyFirst, totalWeeklyRework, totalWeeklyAudits, weeklyAvgSpeed, totalWeeklyActiveHours, goalMetDays, weeklyRecords } = currentWeeklyStats;
                    let csvContent = "\ufeff日期,初审数量 (单),复审数量 (单),总审核量 (单),退单数量 (单),活跃工时 (小时),初审均速 (单/h),是否达标\n";
                    dateList.forEach(dStr => {
                        const dayInfo = weeklyData[dStr];
                        const daySpeed = dayInfo.activeHours > 0 ? (dayInfo.firstRound / dayInfo.activeHours).toFixed(1) : '0.0';
                        const dayTarget = getTargetForDate(dStr);
                        const isGoalMet = dayInfo.firstRound >= dayTarget;

                        const dayRecords = (weeklyRecords || []).filter(item => item.reviewedtime && item.reviewedtime.startsWith(dStr));
                        const currentIds = dayRecords.map(item => item.id || item.reviewedtime);
                        let observedIds = getObservedIdsForDate(dStr);

                        const legacyMax = getMaxObservedForDate(dStr);
                        if (observedIds.length === 0 && legacyMax > currentIds.length) {
                            observedIds = [...currentIds];
                            const diff = legacyMax - currentIds.length;
                            for (let i = 0; i < diff; i++) {
                                observedIds.push(`legacy-rejected-dummy-${i}`);
                            }
                            setObservedIdsForDate(dStr, observedIds);
                        }

                        const newIds = currentIds.filter(id => !observedIds.includes(id));
                        if (newIds.length > 0) {
                            observedIds = [...observedIds, ...newIds];
                            setObservedIdsForDate(dStr, observedIds);
                        }

                        const missingIds = observedIds.filter(id => !currentIds.includes(id));
                        const rejectedCount = missingIds.length;
                        csvContent += `"${dStr}","${dayInfo.firstRound}","${dayInfo.rework}","${dayInfo.total}","${rejectedCount}","${dayInfo.activeHours}","${daySpeed}","${isGoalMet ? '是' : '否'}"\n`;
                    });

                    csvContent += `"\n指标项目 (含单位)","指标数值"\n`;
                    csvContent += `"7日初审总量 (单)","${totalWeeklyFirst}"\n`;
                    csvContent += `"7日复审总量 (单)","${totalWeeklyRework}"\n`;
                    csvContent += `"7日总审核量 (单)","${totalWeeklyAudits}"\n`;
                    csvContent += `"周均初审时速 (单/h)","${weeklyAvgSpeed}"\n`;
                    csvContent += `"周总工时 (小时)","${totalWeeklyActiveHours}"\n`;
                    csvContent += `"达标天数 (天)","${goalMetDays}"\n`;

                    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement("a");
                    link.setAttribute("href", url);
                    link.setAttribute("download", `爱零工周效能报表_${dateList[0]}_至_${dateList[6]}.csv`);
                    link.style.visibility = 'hidden';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                }
            });
        }
    };

        const updateDateUI = () => {
        const dateInput = document.getElementById('sj-date-select');
        dateInput.value = formatDate(currentDate);

        const nextBtn = document.getElementById('sj-date-next');
        const todayStr = formatDate(new Date());
        const selectedStr = formatDate(currentDate);
        nextBtn.disabled = (selectedStr === todayStr);
    };

    const formatDate = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    // 判断日期范围是否包含今天
    const isTodayRange = (endTime) => {
        const todayStr = formatDate(new Date());
        return endTime.startsWith(todayStr);
    };

    // 发起查询并进行统计 (支持按标签页和内存缓存加载)
    const loadStats = async () => {
        if (chartInstance) {
            chartInstance.dispose();
            chartInstance = null;
        }

        const content = document.getElementById('sj-stats-content');
        content.innerHTML = `
            <div class="sj-loading-overlay">
                <div class="sj-spinner"></div>
                <div id="sj-loading-text" style="color: #64748b; font-size: 13px; font-weight: 500;">正在获取数据并加载渲染，请稍候...</div>
            </div>
        `;

        const token = localStorage.getItem('token');
        if (!token) {
            content.innerHTML = `<div style="text-align: center; color: #ef4444; padding: 20px;">未获取到登录Token，请重新刷新网页或重新登录！</div>`;
            return;
        }

        if (currentTab === 'daily') {
            const dateStr = formatDate(currentDate);
            const yestDate = new Date(currentDate);
            yestDate.setDate(yestDate.getDate() - 1);
            const yestDateStr = formatDate(yestDate);

            try {
                // 1. 加载今日数据
                const allRecords = await fetchRecordsForDate(token, dateStr, (loaded, total) => {
                    const loader = document.getElementById('sj-loading-text');
                    if (loader) {
                        loader.innerText = `今日数据拉取中... 已加载 ${loaded} / ${total} 条`;
                    }
                });

                // 2. 加载昨日数据（作为同期对照，默默拉取，出错不阻断主流程）
                let yesterdayRecords = [];
                try {
                    const loader = document.getElementById('sj-loading-text');
                    if (loader) {
                        loader.innerText = `正在读取昨日同期数据作为对照...`;
                    }
                    yesterdayRecords = await fetchRecordsForDate(token, yestDateStr);
                } catch (err) {
                    console.warn("Failed to fetch yesterday's reference data:", err);
                }

                renderStats(allRecords, yesterdayRecords);
            } catch (error) {
                console.error('Error fetching statistics:', error);
                content.innerHTML = `<div style="text-align: center; color: #ef4444; padding: 20px;">日效能数据拉取失败，这可能是由于接口限频或登录已过期。</div>`;
            }
        } else {
            // 周趋势
            const dateList = [];
            const todayObj = new Date(currentDate);
            for (let i = 6; i >= 0; i--) {
                const d = new Date(todayObj);
                d.setDate(todayObj.getDate() - i);
                dateList.push(formatDate(d));
            }

            try {
                const allRecords = [];
                for (let i = 0; i < dateList.length; i++) {
                    const dStr = dateList[i];
                    const loader = document.getElementById('sj-loading-text');
                    if (loader) {
                        loader.innerText = `正在拉取周效能数据... (${i + 1}/7) [${dStr.substring(5)}]`;
                    }
                    const dayRecords = await fetchRecordsForDate(token, dStr);
                    allRecords.push(...dayRecords);
                }
                renderWeeklyStats(allRecords);
            } catch (error) {
                console.error('Error fetching weekly statistics:', error);
                content.innerHTML = `<div style="text-align: center; color: #ef4444; padding: 20px;">周效能数据拉取失败，这可能是由于接口限频或登录已过期。</div>`;
            }
        }
    };

    // 获取单日数据，支持按日期做内存缓存与 sessionStorage 缓存，避免重复加载历史数据 (v2.2)
    const fetchRecordsForDate = async (token, dateStr, onProgress) => {
        const todayStr = formatDate(new Date());
        const canCache = (dateStr !== todayStr); // 今天的订单属于变动状态，不进行持久缓存

        if (canCache) {
            // 1. 尝试从内存缓存中读取
            if (queryCache[dateStr]) {
                if (onProgress) {
                    onProgress(queryCache[dateStr].length, queryCache[dateStr].length);
                }
                return queryCache[dateStr];
            }
            // 2. 尝试从 sessionStorage 跨页持久化中读取
            try {
                const sessionCached = sessionStorage.getItem(`sj_cache_records_v3.6_${dateStr}`);
                if (sessionCached) {
                    const parsed = JSON.parse(sessionCached);
                    queryCache[dateStr] = parsed;
                    if (onProgress) {
                        onProgress(parsed.length, parsed.length);
                    }
                    return parsed;
                }
            } catch (e) {
                console.warn("Failed to parse sessionStorage cache:", e);
            }
        }

        const startTime = `${dateStr} 00:00:00`;
        const endTime = `${dateStr} 23:59:59`;

        let page = 1;
        const perPage = 100;
        let allData = [];
        let hasMore = true;

        while (hasMore) {
            const response = await fetch('https://order-audit-api.slicejobs.com/admin/audit_task/query', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json;charset=UTF-8',
                    'sj-auth-token': token
                },
                body: JSON.stringify({
                    status: 2,
                    reviewedtime: [startTime, endTime],
                    current_page: page,
                    per_page: perPage
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP: ${response.status}`);
            }

            const resData = await response.json();
            if (resData.ret !== 0) {
                throw new Error(resData.msg || 'Error');
            }

            const dataList = resData.detail.data || [];
            allData = allData.concat(dataList);

            const total = resData.detail.total || 0;

            if (onProgress) {
                onProgress(allData.length, total);
            }

            if (allData.length >= total || dataList.length < perPage) {
                hasMore = false;
            } else {
                page++;
            }
        }

        if (canCache) {
            queryCache[dateStr] = allData;
            try {
                // 持久化 id, reviewedtime, review 属性，节约体积的同时保留唯一工单标识，防止溢出 5MB 的 sessionStorage 限制
                const minimalData = allData.map(item => ({
                    id: item.id || item.orderid || item.taskid || item.reviewedtime,
                    reviewedtime: item.reviewedtime,
                    review: item.review
                }));
                sessionStorage.setItem(`sj_cache_records_v3.6_${dateStr}`, JSON.stringify(minimalData));
            } catch (e) {
                console.warn("Failed to write sessionStorage cache:", e);
            }
        }

        return allData;
    };

    // 渲染日分析页面
    const renderStats = (records, yesterdayRecords = []) => {
        // 执行自愈自净化，消除跨天合并数据造成的 ID 污染
        sanitizeAllObservedIds([...records, ...yesterdayRecords]);

        const hourlyStats = Array.from({ length: 24 }, () => 0);
        const hourlyReworkStats = Array.from({ length: 24 }, () => 0);
        const yesterdayHourlyStats = Array.from({ length: 24 }, () => 0);
        const yesterdayHourlyReworkStats = Array.from({ length: 24 }, () => 0);

        records.forEach(item => {
            if (item.reviewedtime) {
                let hour = parseInt(item.reviewedtime.substring(11, 13), 10);
                if (!isNaN(hour)) {
                    // 应用合并规则 (12-13点午休数据全部归并入11-12点)
                    if (hour === 8) {
                        hour = 9;  // 8-9点合并进9点
                    } else if (hour === 12) {
                        hour = 11; // 12-13点午休全部合并入11点段
                    } else if (hour === 18) {
                        hour = 17; // 18-19点合并进17点
                    }

                    if (hour >= 0 && hour < 24) {
                        if (isFirstRoundAudit(item)) {
                            hourlyStats[hour]++;
                        } else {
                            hourlyReworkStats[hour]++;
                        }
                    }
                }
            }
        });

        yesterdayRecords.forEach(item => {
            if (item.reviewedtime) {
                let hour = parseInt(item.reviewedtime.substring(11, 13), 10);
                if (!isNaN(hour)) {
                    if (hour === 8) {
                        hour = 9;
                    } else if (hour === 12) {
                        hour = 11;
                    } else if (hour === 18) {
                        hour = 17;
                    }

                    if (hour >= 0 && hour < 24) {
                        if (isFirstRoundAudit(item)) {
                            yesterdayHourlyStats[hour]++;
                        } else {
                            yesterdayHourlyReworkStats[hour]++;
                        }
                    }
                }
            }
        });

        const selectedDateStr = formatDate(currentDate);
        const isToday = (selectedDateStr === formatDate(new Date()));
        const nowHour = new Date().getHours();
        const nowMin = new Date().getMinutes();

        // 自动识别在家办公模式 (Home-office Mode)
        const coreHours = [9, 10, 11, 13, 14, 15, 16, 17];
        const extraHours = [];
        for (let h = 0; h < 24; h++) {
            if (hourlyStats[h] > 0 || hourlyReworkStats[h] > 0 || yesterdayHourlyStats[h] > 0 || yesterdayHourlyReworkStats[h] > 0) {
                if (!coreHours.includes(h)) {
                    extraHours.push(h);
                }
            }
        }
        const displayHours = [...coreHours, ...extraHours].sort((a, b) => a - b);
        // 只有19点及以后有单子了才会触发在家办公模式
        let todayHasLateAudits = false;
        for (let h = 19; h < 24; h++) {
            if (hourlyStats[h] > 0 || hourlyReworkStats[h] > 0) {
                todayHasLateAudits = true;
                break;
            }
        }
        const isHomeOfficeMode = todayHasLateAudits;
        let totalFirst = 0;
        let totalRework = 0;
        let activeHours = 0;

        // 统计全天所有24小时的总初审和总复审量，防止遗漏排班时段外的加班审核 (v3.6.2)
        for (let h = 0; h < 24; h++) {
            totalFirst += hourlyStats[h];
            totalRework += hourlyReworkStats[h];
        }

        displayHours.forEach(h => {
            if (hourlyStats[h] > 0 || hourlyReworkStats[h] > 0) {
                if (isToday && h === nowHour) {
                    // 对于当前进行中的小时，按当前已过去的分数比例计算（最少计5分钟，防止分母过小造成时速极其不稳定）
                    const fraction = Math.max(5, nowMin) / 60;
                    activeHours += fraction;
                } else {
                    activeHours += 1.0;
                }
            }
        });

        const totalAudits = totalFirst + totalRework;
        const speedPerHour = activeHours > 0 ? (totalFirst / activeHours).toFixed(1) : '0.0';
        const totalSpeedPerHour = activeHours > 0 ? (totalAudits / activeHours).toFixed(1) : '0.0';
        const standardSpeed = (totalFirst / 8).toFixed(1);

        // 每日已观测审核工单 ID 集合管理 (v3.5, v3.6.1 过滤以防跨天合并带来的 ID 交叉污染)
        const dayRecordsForObserved = records.filter(item => item.reviewedtime && item.reviewedtime.startsWith(selectedDateStr));
        const currentIds = dayRecordsForObserved.map(item => item.id || item.orderid || item.taskid || item.reviewedtime);
        let observedIds = getObservedIdsForDate(selectedDateStr);

        // 兼容 v3.4 升级
        const legacyMax = getMaxObservedForDate(selectedDateStr);
        if (observedIds.length === 0 && legacyMax > currentIds.length) {
            observedIds = [...currentIds];
            const diff = legacyMax - currentIds.length;
            for (let i = 0; i < diff; i++) {
                observedIds.push(`legacy-rejected-dummy-${i}`);
            }
            setObservedIdsForDate(selectedDateStr, observedIds);
        }

        // 合并最新发现 of ID
        const newIds = currentIds.filter(id => !observedIds.includes(id));
        if (newIds.length > 0) {
            observedIds = [...observedIds, ...newIds];
            setObservedIdsForDate(selectedDateStr, observedIds);
        }

        // 计算退单：历史曾观测到但在当前列表中缺失的 ID 数量
        const missingIds = observedIds.filter(id => !currentIds.includes(id));
        const rejectedCount = missingIds.length;

        // 保存到全局缓存以供导出 (v3.6 区分初审与复审)
        currentDayStats = {
            dateStr: selectedDateStr,
            hourlyStats: hourlyStats,
            hourlyReworkStats: hourlyReworkStats,
            totalCount: totalFirst,
            totalRework: totalRework,
            totalAudits: totalAudits,
            speedPerHour: speedPerHour,
            totalSpeedPerHour: totalSpeedPerHour,
            activeHours: activeHours,
            observedCount: observedIds.length,
            rejectedCount: rejectedCount
        };

        if (isToday) {
            updateFloatingUI(records);
        }

        // 每日审核目标加载与比例计算
        const target = getTargetForDate(selectedDateStr);
        const progressPercentage = target > 0 ? ((totalFirst / target) * 100).toFixed(1) : '0.0';

        // 计算完成目标所需要的时速 (基于初审量)
        let reqSpeedText = '';
        if (isToday) {
            const remainingHours = 8 - activeHours;
            let reqSpeed = '0.0';
            if (totalFirst < target) {
                reqSpeed = remainingHours > 0 ? ((target - totalFirst) / remainingHours).toFixed(1) : (target - totalFirst).toFixed(1);
            }
            reqSpeedText = `完成初审目标所需时速: <span style="font-weight:600; color: #a855f7;">${reqSpeed}</span> 单/h`;
        } else {
            const reqSpeed = (target / 8).toFixed(1);
            reqSpeedText = `达成初审目标标准时速: <span style="font-weight:600; color: #a855f7;">${reqSpeed}</span> 单/h`;
        }

        // 针对初审计算防摆烂贴士
        let tipsHtml = '';
        let tipsColor = '#94a3b8';
        if (totalFirst >= target) {
            tipsHtml = `🎉 初审已达成目标！开始摸鱼！`;
            tipsColor = '#10b981';
        } else {
            if (parseFloat(speedPerHour) === 0) {
                tipsHtml = `🐢 赶紧开工做一单吧！`;
                tipsColor = '#94a3b8';
            } else {
                const remainingHours = 8 - activeHours;
                let reqSpeed = 0;
                if (remainingHours > 0) {
                    reqSpeed = (target - totalFirst) / remainingHours;
                }
                const currentSpeed = parseFloat(speedPerHour);
                if (currentSpeed >= reqSpeed) {
                    tipsHtml = `⚡ 效率超棒！继续保持！`;
                    tipsColor = '#60a5fa';
                } else if (currentSpeed < reqSpeed * 0.7) {
                    tipsHtml = `⚠️ 进度告急！别摆了干活！`;
                    tipsColor = '#ef4444';
                } else {
                    tipsHtml = `🐢 速度稍慢哦，搞紧搞完！`;
                    tipsColor = '#f59e0b';
                }
            }
        }

        // Card 2 动态指标参数计算
        let card2Title = '工作平均时速 (初审)';
        let card2ValueHtml = `<div style="display: flex; align-items: baseline; justify-content: center; gap: 2px;">${speedPerHour}<span style="font-size:12px; font-weight:500;">单/h</span></div>`;
        let card2SubtextHtml = `
            <div style="font-size: 10px; color: #64748b; text-align: center; width:100%; border-top: 1px solid rgba(168, 85, 247, 0.1); padding-top: 6px; margin-top: 4px; display:flex; flex-direction:column; gap:2px;">
                <div>${reqSpeedText}</div>
            </div>
        `;

        if (isToday) {
            let targetHour = nowHour;
            if (nowHour === 8) targetHour = 9;
            else if (nowHour === 12) targetHour = 11;
            else if (nowHour === 18) targetHour = 17;

            const isCoreHour = displayHours.includes(targetHour);
            if (isCoreHour) {
                card2Title = '当前小时估算时速 (全部)';
                const elapsedFrac = Math.max(5, nowMin) / 60;
                const curHourFirst = hourlyStats[targetHour];
                const curHourRework = hourlyReworkStats[targetHour];
                const curHourTotal = curHourFirst + curHourRework;
                const curHourSpeed = (curHourTotal / elapsedFrac).toFixed(1);  // 全部订单（初审+复审）的时速

                // 计算当前时速与所需时速的差异（基于初审目标，用总速度对比判断是否跟得上）
                const remainingHours = 8 - activeHours;
                let reqSpeedNum = 0;
                if (totalFirst < target && remainingHours > 0) {
                    reqSpeedNum = (target - totalFirst) / remainingHours;
                }
                const currentSpeedNum = parseFloat(curHourSpeed);
                let diffLabel = '';
                if (curHourTotal > 0) {
                    const diff = currentSpeedNum - reqSpeedNum;
                    if (diff >= 0) {
                        diffLabel = `<span style="color: #10b981; font-weight: 600; font-size: 9.5px; margin-top: 1px; display: block;">当前时速超前 ${diff.toFixed(1)} 单/h ⚡</span>`;
                    } else {
                        diffLabel = `<span style="color: #ef4444; font-weight: 600; font-size: 9.5px; margin-top: 1px; display: block;">当前时速落后 ${Math.abs(diff).toFixed(1)} 单/h 🐢</span>`;
                    }
                } else {
                    diffLabel = `<span style="color: #94a3b8; font-weight: 600; font-size: 9.5px; margin-top: 1px; display: block;">本小时暂无审核 🐢</span>`;
                }

                card2ValueHtml = `<div style="display: flex; align-items: baseline; justify-content: center; gap: 2px;">${curHourSpeed}<span style="font-size:12px; font-weight:500;">单/h</span></div>${diffLabel}`;
                card2SubtextHtml = `
                    <div style="display:flex; flex-direction:column; width:100%; border-top: 1px solid rgba(168, 85, 247, 0.1); padding-top: 6px; margin-top: 4px; gap: 2px;">
                        <div style="display:flex; justify-content:space-between; font-size:10px; color:#64748b;">
                            <span>今日均速: <span style="font-weight:600; color:#cbd5e1;">${totalSpeedPerHour}单/h</span></span>
                        </div>
                        <div style="font-size: 10px; text-align: left; color:#64748b;">
                            ${reqSpeedText}
                        </div>
                    </div>
                `;

            } else {
                card2SubtextHtml = `
                    <div style="display:flex; flex-direction:column; width:100%; border-top: 1px solid rgba(168, 85, 247, 0.1); padding-top: 6px; margin-top: 4px; gap: 2px;">
                        <div style="display:flex; justify-content:space-between; font-size:10px; color:#64748b;">
                            <span>当前非核心工时段 (${String(nowHour).padStart(2, '0')}:${String(nowMin).padStart(2, '0')})</span>
                        </div>
                        <div style="display:flex; justify-content:space-between; font-size:10px; color:#64748b;">
                            <span>今日均速: <span style="font-weight:600; color:#cbd5e1;">${totalSpeedPerHour}单/h</span></span>
                        </div>
                        <div style="font-size: 10px; text-align: left; color:#64748b;">
                            ${reqSpeedText}
                        </div>
                    </div>
                `;
            }
        }


        // 智能预测计算 (基于初审)
        let predictionHtml = '';
        if (totalFirst >= target) {
            predictionHtml = `
                <div style="font-size: 10px; color: #10b981; font-weight: 600; text-align: left; margin-top: 6px; display: flex; align-items: center; gap: 4px;">
                    <svg viewBox="0 0 24 24" style="width:12px; height:12px; fill:none; stroke:currentColor; stroke-width:3; stroke-linecap:round; stroke-linejoin:round;"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    初审目标已达成！超额 ${totalFirst - target} 单
                </div>
            `;
        } else {
            const remaining = target - totalFirst;
            if (parseFloat(speedPerHour) > 0) {
                const hoursNeeded = remaining / parseFloat(speedPerHour);
                const hPart = Math.floor(hoursNeeded);
                const mPart = Math.round((hoursNeeded - hPart) * 60);
                let timeStr = "";
                if (hPart > 0) timeStr += `${hPart}小时`;
                if (mPart > 0 || hPart === 0) timeStr += `${mPart}分钟`;
                predictionHtml = `
                    <div style="font-size: 10px; color: #94a3b8; font-weight: 500; text-align: left; margin-top: 6px;">
                        预测: 距初审还差 <span style="color:#60a5fa; font-weight:600;">${remaining}</span> 单，约需 <span style="color:#f59e0b; font-weight:600;">${timeStr}</span>
                    </div>
                `;
            } else {
                predictionHtml = `
                    <div style="font-size: 10px; color: #64748b; font-weight: 500; text-align: left; margin-top: 6px;">
                        预测: 距初审还差 ${remaining} 单 (等待开始工作以估算)
                    </div>
                `;
            }
        }

        // 明细表格 HTML 生成
        let tableRowsHtml = '';
        displayHours.forEach(hour => {
            const countFirst = hourlyStats[hour];
            const countRework = hourlyReworkStats[hour];
            const countTotal = countFirst + countRework;
            let timeLabel = `${String(hour).padStart(2, '0')}:00 - ${String(hour).padStart(2, '0')}:59`;

            if (hour === 9) {
                timeLabel = `09:00 - 09:59 <span style="color:#475569; font-size:10px; font-weight:normal;">(含8点提前量)</span>`;
            } else if (hour === 11) {
                timeLabel = `11:00 - 11:59 <span style="color:#475569; font-size:10px; font-weight:normal;">(含12点午休量)</span>`;
            } else if (hour === 17) {
                timeLabel = `17:00 - 17:59 <span style="color:#475569; font-size:10px; font-weight:normal;">(含18点加班量)</span>`;
            }

            const countColor = countTotal > 0 ? '#f1f5f9' : '#475569';
            const countWeight = countTotal > 0 ? '700' : '500';
            const labelColor = countTotal > 0 ? '#94a3b8' : '#475569';

            let countDisplay = `${countFirst} 单`;
            if (countRework > 0) {
                countDisplay = `${countFirst} <span style="color: #a855f7; font-size: 11px; font-weight: 500;">+${countRework}复</span> 单`;
            }

            tableRowsHtml += `
                <tr style="${countTotal === 0 ? 'opacity: 0.65;' : ''}">
                    <td style="font-weight: 600; color: ${labelColor};">${timeLabel}</td>
                    <td style="font-weight: ${countWeight}; color: ${countColor}; font-size: 14px;">${countDisplay}</td>
                </tr>
            `;
        });

        // 每日审核最高记录观测判定
        let rejectedHtml = '';
        if (rejectedCount > 0) {
            rejectedHtml = `<span style="color: #ef4444; font-size: 10.5px; font-weight: 600; background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 4px; padding: 1px 5px; display: inline-flex; align-items: center; gap: 2px; cursor: help; vertical-align: middle; margin-bottom: 2px;" title="该日期曾观测到过共 ${observedIds.length} 单审核，现缺失了 ${rejectedCount} 单，可能已被审核管理员退单">⚠️ 退单: ${rejectedCount}</span>`;
        }

        let homeOfficeBadge = '';
        if (isHomeOfficeMode) {
            homeOfficeBadge = `
                <div class="sj-home-office-banner" style="display: flex; align-items: center; gap: 6px; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 8px; padding: 8px 12px; margin-bottom: 12px; color: #10b981; font-size: 11.5px; font-weight: 600; text-align: left; width: 100%; box-sizing: border-box;">
                    <span style="font-size: 13px;">🏠</span>
                    <span>已自动识别：<strong>在家办公模式</strong>（检测到非核心时段数据，已动态显示全天 24 小时所有时段的审核数据）</span>
                </div>
            `;
        }

        const content = document.getElementById('sj-stats-content');
        content.innerHTML = `
            ${homeOfficeBadge}
            <!-- 数字汇总指标卡片 -->
            <div class="sj-stats-grid">
                <div class="sj-stats-box sj-box-blue" style="justify-content: space-between; height: 130px; padding: 12px; position: relative;">
                    <div style="display: flex; align-items: center; gap: 4px; width: 100%;">
                        <svg viewBox="0 0 24 24" style="width: 14px; height: 14px; fill: none; stroke: #3b82f6; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                        <span class="sj-stats-box-label" style="flex: 1; text-align: left;">今日初审量 (考核)</span>
                        <span id="sj-target-edit" class="sj-target-edit-btn" title="设置每日目标" style="cursor: pointer; opacity: 0.5; display: inline-flex; align-items: center; transition: all 0.2s; color: #60a5fa;">
                            <svg viewBox="0 0 24 24" style="width: 12px; height: 12px; fill: currentColor;"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                        </span>
                    </div>
                    <div class="sj-stats-box-value sj-text-blue" style="font-size: 24px; display: flex; align-items: center; justify-content: center; gap: 6px;">
                        ${totalFirst}
                        <span style="font-size: 13px; color: #64748b; font-weight: 500; margin-left: 2px;">/ ${totalAudits} 总量</span>
                        ${rejectedHtml}
                    </div>
                    <div style="width: 100%;">
                        <div style="display: flex; justify-content: space-between; font-size: 10px; color: #64748b; margin-bottom: 2px;">
                            <span>目标: <span id="sj-target-text" style="font-weight:600;">${target}</span></span>
                            <span id="sj-target-pct" style="font-weight:600; color:#60a5fa;">${progressPercentage}%</span>
                        </div>
                        <div style="width: 100%; height: 4px; background: rgba(59, 130, 246, 0.1); border-radius: 2px; overflow: hidden;">
                            <div id="sj-target-bar" style="width: ${Math.min(100, parseFloat(progressPercentage))}%; height: 100%; background: #3b82f6; border-radius: 2px; transition: width 0.5s ease-out;"></div>
                        </div>
                        ${predictionHtml}
                    </div>

                    <!-- 每日目标弹窗编辑层 -->
                    <div id="sj-target-popover" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(9, 13, 22, 0.96); backdrop-filter: blur(6px); display: none; flex-direction: column; align-items: center; justify-content: center; gap: 8px; border-radius: 16px; padding: 12px; z-index: 10; border: 1px solid rgba(59, 130, 246, 0.35);">
                        <div style="font-size: 11px; color: #94a3b8; font-weight: 600;">设置每日目标单量</div>
                        <div style="display: flex; gap: 6px; width: 100%; justify-content: center; align-items: center;">
                            <input type="number" id="sj-target-input" value="${target}" style="width: 70px; background: #1e293b; border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; padding: 4px 6px; color: white; font-size: 13px; font-weight: 600; outline: none; text-align: center;">
                            <button id="sj-target-save" style="background: #3b82f6; border: none; border-radius: 6px; padding: 4px 10px; color: white; font-size: 11px; font-weight: 600; cursor: pointer; transition: background 0.2s;">保存</button>
                            <button id="sj-target-cancel" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 4px 10px; color: #94a3b8; font-size: 11px; cursor: pointer;">取消</button>
                        </div>
                    </div>
                </div>
                <div class="sj-stats-box sj-box-purple" style="justify-content: space-between; height: 130px; padding: 12px;">
                    <div style="display: flex; align-items: center; gap: 4px; width: 100%;">
                        <svg viewBox="0 0 24 24" style="width: 14px; height: 14px; fill: none; stroke: #a855f7; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
                        <span class="sj-stats-box-label" style="flex: 1; text-align: left;">${card2Title}</span>
                    </div>
                    <div class="sj-stats-box-value sj-text-purple" style="font-size: 24px; display: flex; flex-direction: column; align-items: center; line-height: 1.1; width: 100%; text-align: center;">${card2ValueHtml}</div>
                    ${card2SubtextHtml}
                </div>
                <div class="sj-stats-box sj-box-amber" style="justify-content: space-between; height: 130px; padding: 12px;">
                    <div style="display: flex; align-items: center; gap: 4px; width: 100%;">
                        <svg viewBox="0 0 24 24" style="width: 14px; height: 14px; fill: none; stroke: #f59e0b; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                        <span class="sj-stats-box-label" style="flex: 1; text-align: left;">活跃工作时数</span>
                    </div>
                    <div class="sj-stats-box-value sj-text-amber" style="font-size: 26px;">${activeHours.toFixed(1)}<span style="font-size:12px; font-weight:500; margin-left:2px;">小时</span></div>
                    <div style="width: 100%;">
                        <div style="display: flex; justify-content: space-between; font-size: 10px; color: #64748b; margin-bottom: 2px;">
                            <span>常规工时: 8h</span>
                            <span style="font-weight:600; color:#f59e0b;">${(activeHours / 8 * 100).toFixed(0)}%</span>
                        </div>
                        <div style="width: 100%; height: 4px; background: rgba(245, 158, 11, 0.1); border-radius: 2px; overflow: hidden;">
                            <div style="width: ${Math.min(100, (activeHours / 8 * 100))}%; height: 100%; background: #f59e0b; border-radius: 2px; transition: width 0.5s ease-out;"></div>
                        </div>
                        <div style="display: flex; justify-content: space-between; font-size: 10px; margin-top: 6px;">
                            <span style="color: #64748b;">${isToday ? '剩余常规工时' : '偏离工时'}</span>
                            <span style="color: #cbd5e1; font-weight: 600;">${Math.abs(activeHours - 8).toFixed(1)}h</span>
                        </div>
                        <div style="color: ${tipsColor}; font-weight: 600; font-size: 10px; text-align: left; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%;" title="${tipsHtml}">
                            ${tipsHtml}
                        </div>
                    </div>
                </div>
            </div>

            <!-- ECharts 个人效率折线趋势图 -->
            <div class="sj-chart-wrapper">
                <h4 class="sj-chart-title">单日工作效率走势 (12:00-13:00午休单量已自动归入11点，虚线为昨日总量)</h4>
                <div id="sj-stats-chart-div"></div>
            </div>

            <!-- 详细表格 -->
            <div class="sj-details-wrapper">
                <h4 class="sj-details-title">工作时段审核明细</h4>
                <div style="border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; overflow: hidden; background: rgba(255,255,255,0.01);">
                    <table class="sj-details-table">
                        <thead>
                            <tr>
                                <th>时间段</th>
                                <th>审核订单数</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tableRowsHtml}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        // 重新绑定目标设置按钮和弹窗事件
        const editBtn = document.getElementById('sj-target-edit');
        const popover = document.getElementById('sj-target-popover');
        const targetInput = document.getElementById('sj-target-input');
        const targetSaveBtn = document.getElementById('sj-target-save');
        const targetCancelBtn = document.getElementById('sj-target-cancel');

        if (editBtn && popover && targetInput) {
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                popover.style.display = 'flex';
                targetInput.focus();
                targetInput.select();
            });

            targetCancelBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                popover.style.display = 'none';
            });

            // 点击外部关闭弹窗
            document.addEventListener('click', function closePopover(event) {
                if (popover && popover.style.display === 'flex' && !popover.contains(event.target)) {
                    popover.style.display = 'none';
                    document.removeEventListener('click', closePopover);
                }
            });

            targetSaveBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const parsed = parseInt(targetInput.value, 10);
                if (!isNaN(parsed) && parsed > 0) {
                    setTargetForDate(selectedDateStr, parsed);

                    // 重新加载统计以更新所有卡片和走势图的计算
                    loadStats();
                } else {
                    alert("请输入有效的正整数！");
                }
            });
        }

        if (targetInput) {
            targetInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    targetSaveBtn.click();
                } else if (e.key === 'Escape') {
                    e.stopPropagation(); // 阻止事件冒泡，避免同时关闭整个面板
                    targetCancelBtn.click();
                }
            });
        }

        // 异步渲染 ECharts 堆叠柱状趋势图 (v3.6)
        setTimeout(() => {
            initEChart(displayHours, hourlyStats, hourlyReworkStats, yesterdayHourlyStats, yesterdayHourlyReworkStats);
        }, 50);
    };    // 渲染近 7 日周分析页面 (v1.8新增, v3.6 升级区分初审复审)
    const renderWeeklyStats = (records) => {
        // 执行自愈自净化，消除跨天合并数据造成的 ID 污染
        sanitizeAllObservedIds(records);

        // 1. 初始化最后7天的数据
        const today = new Date();
        const dateList = [];
        const dateLabels = [];
        const weeklyData = {};

        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(today.getDate() - i);
            const dateStr = formatDate(d);
            dateList.push(dateStr);
            dateLabels.push(dateStr.substring(5)); // M-D 格式 e.g., '06-21'
            weeklyData[dateStr] = {
                total: 0,
                firstRound: 0,
                rework: 0,
                activeHours: 0,
                hourlyStats: Array.from({ length: 24 }, () => 0),
                hourlyReworkStats: Array.from({ length: 24 }, () => 0)
            };
        }

        // 2. 统计单量
        records.forEach(item => {
            if (item.reviewedtime) {
                const dateStr = item.reviewedtime.substring(0, 10);
                if (weeklyData[dateStr]) {
                    const isFirst = isFirstRoundAudit(item);
                    if (isFirst) {
                        weeklyData[dateStr].firstRound++;
                    } else {
                        weeklyData[dateStr].rework++;
                    }
                    weeklyData[dateStr].total++;

                    let hour = parseInt(item.reviewedtime.substring(11, 13), 10);
                    if (hour === 8) hour = 9;
                    else if (hour === 12) hour = 11;
                    else if (hour === 18) hour = 17;
                    if (hour >= 0 && hour < 24) {
                        if (isFirst) {
                            weeklyData[dateStr].hourlyStats[hour]++;
                        } else {
                            weeklyData[dateStr].hourlyReworkStats[hour]++;
                        }
                    }
                }
            }
        });

        // 自动识别在家办公模式 (Home-office Mode) - 周趋势
        const coreHours = [9, 10, 11, 13, 14, 15, 16, 17];
        const extraHours = [];
        for (let h = 0; h < 24; h++) {
            let hourHasData = false;
            dateList.forEach(dateStr => {
                const dayInfo = weeklyData[dateStr];
                if (dayInfo.hourlyStats[h] > 0 || dayInfo.hourlyReworkStats[h] > 0) {
                    hourHasData = true;
                }
            });
            if (hourHasData && !coreHours.includes(h)) {
                extraHours.push(h);
            }
        }
        const displayHours = [...coreHours, ...extraHours].sort((a, b) => a - b);
        // 周维度：只有近7天有任何一天在19点及以后有单子才会触发
        let weeklyHasLateAudits = false;
        dateList.forEach(dateStr => {
            const dayInfo = weeklyData[dateStr];
            for (let h = 19; h < 24; h++) {
                if (dayInfo.hourlyStats[h] > 0 || dayInfo.hourlyReworkStats[h] > 0) {
                    weeklyHasLateAudits = true;
                }
            }
        });
        const isWeeklyHomeOfficeMode = weeklyHasLateAudits;
        let totalWeeklyFirst = 0;
        let totalWeeklyRework = 0;
        let totalWeeklyActiveHours = 0;
        let goalMetDays = 0;
        const target = parseInt(localStorage.getItem('sj_stats_target') || '200', 10);

        dateList.forEach(dateStr => {
            const dayInfo = weeklyData[dateStr];
            totalWeeklyFirst += dayInfo.firstRound;
            totalWeeklyRework += dayInfo.rework;

            // 计算当天活跃工时
            let dayActiveHours = 0;
            displayHours.forEach(h => {
                if (dayInfo.hourlyStats[h] > 0 || dayInfo.hourlyReworkStats[h] > 0) {
                    dayActiveHours++;
                }
            });
            dayInfo.activeHours = dayActiveHours;
            totalWeeklyActiveHours += dayActiveHours;

            const dayTarget = getTargetForDate(dateStr);
            if (dayInfo.firstRound >= dayTarget) { // 达标只针对初审！
                goalMetDays++;
            }
        });

        const totalWeeklyAudits = totalWeeklyFirst + totalWeeklyRework;
        const weeklyAvgSpeed = totalWeeklyActiveHours > 0 ? (totalWeeklyFirst / totalWeeklyActiveHours).toFixed(1) : '0.0';
        const weeklyAvgTotalSpeed = totalWeeklyActiveHours > 0 ? (totalWeeklyAudits / totalWeeklyActiveHours).toFixed(1) : '0.0';

        // 4. 保存缓存以供 CSV 导出
        currentWeeklyStats = {
            dateLabels: dateLabels,
            dateList: dateList,
            weeklyData: weeklyData,
            totalWeeklyFirst: totalWeeklyFirst,
            totalWeeklyRework: totalWeeklyRework,
            totalWeeklyAudits: totalWeeklyAudits,
            weeklyAvgSpeed: weeklyAvgSpeed,
            weeklyAvgTotalSpeed: weeklyAvgTotalSpeed,
            totalWeeklyActiveHours: totalWeeklyActiveHours,
            goalMetDays: goalMetDays,
            weeklyRecords: records
        };

        // 5. 渲染周指标 HTML
        let homeOfficeBadge = '';
        if (isWeeklyHomeOfficeMode) {
            homeOfficeBadge = `
                <div class="sj-home-office-banner" style="display: flex; align-items: center; gap: 6px; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 8px; padding: 8px 12px; margin-bottom: 12px; color: #10b981; font-size: 11.5px; font-weight: 600; text-align: left; width: 100%; box-sizing: border-box;">
                    <span style="font-size: 13px;">🏠</span>
                    <span>已自动识别：<strong>在家办公模式</strong>（已动态统计近7日所有的非核心活动工时数据）</span>
                </div>
            `;
        }

        const content = document.getElementById('sj-stats-content');
        content.innerHTML = `
            ${homeOfficeBadge}
            <!-- 数字汇总指标卡片 -->
            <div class="sj-stats-grid">
                <div class="sj-stats-box sj-box-blue" style="justify-content: space-between; height: 110px; padding: 16px 12px;">
                    <div style="display: flex; align-items: center; gap: 4px; width: 100%;">
                        <svg viewBox="0 0 24 24" style="width: 14px; height: 14px; fill: none; stroke: #3b82f6; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                        <span class="sj-stats-box-label" style="flex: 1; text-align: left;">近7日初审总量</span>
                    </div>
                    <div class="sj-stats-box-value sj-text-blue" style="font-size: 24px; display: flex; align-items: center; justify-content: center; gap: 6px;">
                        ${totalWeeklyFirst}
                        <span style="font-size: 13px; color: #64748b; font-weight: 500; margin-left: 2px;">/ ${totalWeeklyAudits} 总量</span>
                    </div>
                    <div style="font-size: 10px; color: #64748b; text-align: center; width: 100%; border-top: 1px solid rgba(59, 130, 246, 0.1); padding-top: 6px;">
                        日均初审: <span style="font-weight:600; color: #3b82f6;">${(totalWeeklyFirst / 7).toFixed(0)}</span> 单/天 (总量: ${(totalWeeklyAudits / 7).toFixed(0)})
                    </div>
                </div>
                <div class="sj-stats-box sj-box-purple" style="justify-content: space-between; height: 110px; padding: 16px 12px;">
                    <div style="display: flex; align-items: center; gap: 4px; width: 100%;">
                        <svg viewBox="0 0 24 24" style="width: 14px; height: 14px; fill: none; stroke: #a855f7; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
                        <span class="sj-stats-box-label" style="flex: 1; text-align: left;">周均初审时速</span>
                    </div>
                    <div class="sj-stats-box-value sj-text-purple" style="font-size: 24px;">${weeklyAvgSpeed}<span style="font-size:12px; font-weight:500; margin-left:2px;">单/h</span></div>
                    <div style="font-size: 10px; color: #64748b; text-align: center; width:100%; border-top: 1px solid rgba(168, 85, 247, 0.1); padding-top: 6px;">
                        周均总速: <span style="font-weight:600; color: #cbd5e1;">${weeklyAvgTotalSpeed}单/h</span> | 总时长: ${totalWeeklyActiveHours}h
                    </div>
                </div>
                <div class="sj-stats-box sj-box-amber" style="justify-content: space-between; height: 110px; padding: 16px 12px;">
                    <div style="display: flex; align-items: center; gap: 4px; width: 100%;">
                        <svg viewBox="0 0 24 24" style="width: 14px; height: 14px; fill: none; stroke: #f59e0b; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                        <span class="sj-stats-box-label" style="flex: 1; text-align: left;">目标达成天数</span>
                    </div>
                    <div class="sj-stats-box-value sj-text-amber" style="font-size: 28px;">${goalMetDays}<span style="font-size:12px; font-weight:500; margin-left:2px;">天</span></div>
                    <div style="width: 100%;">
                        <div style="display: flex; justify-content: space-between; font-size: 10px; color: #64748b; margin-bottom: 2px;">
                            <span>目标: ${target}单</span>
                            <span style="font-weight:600; color:#f59e0b;">${(goalMetDays / 7 * 100).toFixed(0)}%</span>
                        </div>
                        <div style="width: 100%; height: 4px; background: rgba(245, 158, 11, 0.1); border-radius: 2px; overflow: hidden;">
                            <div style="width: ${(goalMetDays / 7 * 100).toFixed(0)}%; height: 100%; background: #f59e0b; border-radius: 2px; transition: width 0.5s ease-out;"></div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- ECharts 周效能趋势图 -->
            <div class="sj-chart-wrapper">
                <h4 class="sj-chart-title">近 7 日审核单量分布趋势走势 (柱状图堆叠展示初审与复审)</h4>
                <div id="sj-stats-chart-div"></div>
            </div>

            <!-- 周报明细表 -->
            <div class="sj-details-wrapper">
                <h4 class="sj-details-title">近 7 日效能明细报表</h4>
                <div style="border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; overflow: hidden; background: rgba(255,255,255,0.01);">
                    <table class="sj-details-table">
                        <thead>
                            <tr>
                                <th>日期</th>
                                <th>审核单量 (初审)</th>
                                <th>活跃工时</th>
                                <th>当日初审均速</th>
                                <th>状态</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${dateList.map(dateStr => {
                                const dayInfo = weeklyData[dateStr];
                                const daySpeed = dayInfo.activeHours > 0 ? (dayInfo.firstRound / dayInfo.activeHours).toFixed(1) : '0.0';
                                const dayTotalSpeed = dayInfo.activeHours > 0 ? (dayInfo.total / dayInfo.activeHours).toFixed(1) : '0.0';
                                const dayTarget = getTargetForDate(dateStr);
                                const isGoalMet = dayInfo.firstRound >= dayTarget;
                                const statusColor = isGoalMet ? '#10b981' : '#ef4444';
                                const statusBg = isGoalMet ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)';
                                const statusText = isGoalMet ? `达标 (目标 ${dayTarget})` : `未达标 (目标 ${dayTarget})`;

                                // 计算退单 (v3.5)
                                const dayRecords = records.filter(item => item.reviewedtime && item.reviewedtime.startsWith(dateStr));
                                const currentIds = dayRecords.map(item => item.id || item.reviewedtime);
                                let observedIds = getObservedIdsForDate(dateStr);

                                // 兼容 v3.4 升级
                                const legacyMax = getMaxObservedForDate(dateStr);
                                if (observedIds.length === 0 && legacyMax > currentIds.length) {
                                    observedIds = [...currentIds];
                                    const diff = legacyMax - currentIds.length;
                                    for (let i = 0; i < diff; i++) {
                                        observedIds.push(`legacy-rejected-dummy-${i}`);
                                    }
                                    setObservedIdsForDate(dateStr, observedIds);
                                }

                                // 合并最新发现的 ID
                                const newIds = currentIds.filter(id => !observedIds.includes(id));
                                if (newIds.length > 0) {
                                    observedIds = [...observedIds, ...newIds];
                                    setObservedIdsForDate(dateStr, observedIds);
                                }

                                // 计算退单
                                const missingIds = observedIds.filter(id => !currentIds.includes(id));
                                const rejectedCount = missingIds.length;

                                let rejectedLabel = '';
                                if (rejectedCount > 0) {
                                    rejectedLabel = ` <span style="color: #ef4444; font-size: 9px; font-weight: 600; background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 3px; padding: 1px 4px; margin-left: 4px; display: inline-block; vertical-align: middle; cursor: help;" title="该日期曾观测到过共 ${observedIds.length} 单审核，现缺失了 ${rejectedCount} 单，可能已被审核管理员退单">退 ${rejectedCount}</span>`;
                                }

                                let dayInfoCountDisplay = `${dayInfo.firstRound} 单`;
                                if (dayInfo.rework > 0) {
                                    dayInfoCountDisplay = `${dayInfo.firstRound} <span style="color: #a855f7; font-size: 11.5px; font-weight: 500;">+${dayInfo.rework}防</span> 单`;
                                }

                                // Wait, the plan requested '复', let's use '复' for consistency
                                dayInfoCountDisplay = `${dayInfo.firstRound} 单`;
                                if (dayInfo.rework > 0) {
                                    dayInfoCountDisplay = `${dayInfo.firstRound} <span style="color: #a855f7; font-size: 11.5px; font-weight: 500;">+${dayInfo.rework}复</span> 单`;
                                }

                                let daySpeedDisplay = `${daySpeed} 单/h`;
                                if (dayInfo.rework > 0) {
                                    daySpeedDisplay = `${daySpeed} <span style="color:#a855f7; font-size:11px;">(总:${dayTotalSpeed})</span>`;
                                }

                                return `
                                    <tr>
                                        <td style="font-weight: 600; color: #94a3b8;">${dateStr}</td>
                                        <td style="font-weight: 700; color: #f1f5f9; font-size: 14px;">${dayInfoCountDisplay}${rejectedLabel}</td>
                                        <td style="color: #cbd5e1;">${dayInfo.activeHours} 小时</td>
                                        <td style="color: #cbd5e1;">${daySpeedDisplay}</td>
                                        <td>
                                            <span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; color: ${statusColor}; background: ${statusBg};">${statusText}</span>
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        // 异步渲染 ECharts 周效能趋势图 (堆叠柱状图) (v3.6)
        setTimeout(() => {
            const targetValues = dateList.map(d => getTargetForDate(d));
            initWeeklyChart(
                dateLabels,
                dateList.map(d => weeklyData[d].firstRound),
                dateList.map(d => weeklyData[d].rework),
                targetValues
            );
        }, 50);
    };    // 初始化 ECharts 堆叠柱状图 (v3.6 新增区分初审复审)
    const initEChart = (displayHours, hourlyData, hourlyReworkData = [], yesterdayHourlyData = [], yesterdayHourlyReworkData = []) => {
        const chartDom = document.getElementById('sj-stats-chart-div');
        if (!chartDom) return;

        const xData = displayHours.map(h => `${String(h).padStart(2, '0')}:00`);

        const firstRoundSeries = displayHours.map(h => hourlyData[h] || 0);

        const reworkSeries = displayHours.map(h => (hourlyReworkData && hourlyReworkData[h]) || 0);

        const totalSeries = firstRoundSeries.map((val, idx) => val + reworkSeries[idx]);
        const maxVal = Math.max(...totalSeries);
        const hasDataPoints = maxVal > 0;

        let yesterdaySeriesData = [];
        let hasYesterdayData = yesterdayHourlyData.length > 0;
        if (hasYesterdayData) {
            yesterdaySeriesData = displayHours.map(h => (yesterdayHourlyData[h] || 0) + (yesterdayHourlyReworkData[h] || 0));
        }

        chartInstance = echarts.init(chartDom, 'dark', { renderer: 'canvas' });

        const option = {
            backgroundColor: 'transparent',
            tooltip: {
                trigger: 'axis',
                backgroundColor: '#111827',
                borderColor: 'rgba(255, 255, 255, 0.1)',
                textStyle: {
                    color: '#f3f4f6',
                    fontFamily: 'inherit',
                    fontSize: 12
                },
                axisPointer: {
                    type: 'shadow'
                },
                formatter: function (params) {
                    let timeLabel = params[0].name;
                    const h = parseInt(timeLabel.split(':')[0], 10);
                    if (h === 9) {
                        timeLabel = '09:00 (含8点提前打卡数)';
                    } else if (h === 11) {
                        timeLabel = '11:00 (含12点午休量)';
                    } else if (h === 17) {
                        timeLabel = '17:00 (含18点下班尾款数)';
                    } else {
                        timeLabel = `${String(h).padStart(2, '0')}:00 - ${String(h).padStart(2, '0')}:59`;
                    }

                    let firstVal = 0;
                    let reworkVal = 0;
                    let yestVal = 0;
                    let hasYest = false;

                    params.forEach(p => {
                        if (p.seriesName === '今日初审') {
                            firstVal = p.value;
                        } else if (p.seriesName === '今日复审') {
                            reworkVal = p.value;
                        } else if (p.seriesName === '昨日同期') {
                            yestVal = p.value;
                            hasYest = true;
                        }
                    });

                    const totalVal = firstVal + reworkVal;

                    let diffText = '';
                    if (hasYest && yestVal > 0) {
                        const pct = ((totalVal - yestVal) / yestVal * 100).toFixed(0);
                        const sign = pct >= 0 ? '+' : '';
                        const color = pct >= 0 ? '#10b981' : '#ef4444';
                        diffText = `<span style="color: ${color}; margin-left: 6px; font-weight: 600;">(${sign}${pct}%)</span>`;
                    } else if (totalVal > 0 && hasYest) {
                        diffText = `<span style="color: #10b981; margin-left: 6px; font-weight: 600;">(+100%)</span>`;
                    }

                    let html = `<div style="font-weight: 700; margin-bottom: 6px; color: #94a3b8;">${timeLabel}</div>`;
                    html += `<div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom: 4px;">
                                <span style="display:flex; align-items:center; gap:6px; color:#cbd5e1;">
                                    <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#3b82f6;"></span>
                                    今日初审:
                                </span>
                                <b style="color:#ffffff;">${firstVal} 单</b>
                            </div>`;
                    html += `<div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom: 4px;">
                                <span style="display:flex; align-items:center; gap:6px; color:#a855f7;">
                                    <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#a855f7;"></span>
                                    今日复审:
                                </span>
                                <b style="color:#ffffff;">${reworkVal} 单</b>
                            </div>`;
                    html += `<div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom: 4px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 4px;">
                                <span style="display:flex; align-items:center; gap:6px; color:#60a5fa;">
                                    今日总量:
                                </span>
                                <b style="color:#ffffff;">${totalVal} 单 ${diffText}</b>
                            </div>`;

                    if (hasYest) {
                        html += `<div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
                                    <span style="display:flex; align-items:center; gap:6px; color:#64748b;">
                                        <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:rgba(148, 163, 184, 0.4); border: 1px dashed rgba(148, 163, 184, 0.8);"></span>
                                        昨日总量:
                                    </span>
                                    <b style="color:#94a3b8;">${yestVal} 单</b>
                                </div>`;
                    }
                    return html;
                }
            },
            legend: {
                show: true,
                data: ['今日初审', '今日复审', '昨日同期'],
                textStyle: {
                    color: '#64748b',
                    fontSize: 10,
                    fontFamily: 'inherit'
                },
                top: '0%',
                right: '4%'
            },
            grid: {
                left: '3%',
                right: '5%',
                bottom: '6%',
                top: '18%',
                containLabel: true
            },
            xAxis: {
                type: 'category',
                boundaryGap: true,
                data: xData,
                axisLine: {
                    lineStyle: {
                        color: 'rgba(255, 255, 255, 0.08)'
                    }
                },
                axisLabel: {
                    color: '#64748b',
                    fontSize: 10,
                    margin: 12
                }
            },
            yAxis: {
                type: 'value',
                minInterval: 1,
                axisLine: { show: false },
                splitLine: {
                    lineStyle: {
                        color: 'rgba(255, 255, 255, 0.03)'
                    }
                },
                axisLabel: {
                    color: '#64748b',
                    fontSize: 10
                }
            },
            series: [
                {
                    name: '今日初审',
                    type: 'bar',
                    stack: 'today',
                    itemStyle: {
                        color: '#3b82f6'
                    },
                    barWidth: '40%',
                    data: firstRoundSeries
                },
                {
                    name: '今日复审',
                    type: 'bar',
                    stack: 'today',
                    itemStyle: {
                        color: '#a855f7',
                        borderRadius: [4, 4, 0, 0]
                    },
                    barWidth: '40%',
                    data: reworkSeries
                }
            ]
        };

        if (hasYesterdayData) {
            option.series.push({
                name: '昨日同期',
                type: 'line',
                smooth: true,
                showSymbol: false,
                symbol: 'circle',
                symbolSize: 4,
                itemStyle: {
                    color: '#64748b',
                    borderWidth: 1.5,
                    borderColor: '#090d16'
                },
                lineStyle: {
                    width: 2,
                    type: 'dashed',
                    color: '#64748b',
                    opacity: 0.5
                },
                data: yesterdaySeriesData
            });
        }

        chartInstance.setOption(option);

        if (resizeHandler) {
            window.removeEventListener('resize', resizeHandler);
        }
        resizeHandler = () => {
            if (chartInstance) chartInstance.resize();
        };
        window.addEventListener('resize', resizeHandler);
    };

    // 初始化 ECharts 周堆叠柱状图 (v3.6)
    const initWeeklyChart = (labels, firstRoundValues, reworkValues, targetValues) => {
        const chartDom = document.getElementById('sj-stats-chart-div');
        if (!chartDom) return;

        chartInstance = echarts.init(chartDom, 'dark', { renderer: 'canvas' });

        const option = {
            backgroundColor: 'transparent',
            tooltip: {
                trigger: 'axis',
                backgroundColor: '#111827',
                borderColor: 'rgba(255, 255, 255, 0.1)',
                textStyle: {
                    color: '#f3f4f6',
                    fontFamily: 'inherit',
                    fontSize: 12
                },
                axisPointer: {
                    type: 'shadow'
                },
                formatter: function (params) {
                    let dateLabel = params[0].name;
                    let firstVal = 0;
                    let reworkVal = 0;
                    let targetVal = 0;

                    params.forEach(p => {
                        if (p.seriesName === '初审数量') {
                            firstVal = p.value;
                        } else if (p.seriesName === '复审数量') {
                            reworkVal = p.value;
                        } else if (p.seriesName === '预设目标') {
                            targetVal = p.value;
                        }
                    });

                    const totalVal = firstVal + reworkVal;
                    const isGoalMet = firstVal >= targetVal; // 达标指针对初审
                    const statusText = isGoalMet ? '<span style="color: #10b981; font-weight: 700; margin-left: 6px;">(达标)</span>' : '<span style="color: #ef4444; font-weight: 700; margin-left: 6px;">(未达标)</span>';

                    let html = `<div style="font-weight: 700; margin-bottom: 6px; color: #94a3b8;">日期: ${dateLabel}</div>`;
                    html += `<div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom: 4px;">
                                <span style="display:flex; align-items:center; gap:6px; color:#cbd5e1;">
                                    <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#3b82f6;"></span>
                                    初审数量:
                                </span>
                                <b style="color:#ffffff;">${firstVal} 单</b>
                            </div>`;
                    html += `<div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom: 4px;">
                                <span style="display:flex; align-items:center; gap:6px; color:#a855f7;">
                                    <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#a855f7;"></span>
                                    复审数量:
                                </span>
                                <b style="color:#ffffff;">${reworkVal} 单</b>
                            </div>`;
                    html += `<div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom: 4px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 4px;">
                                <span style="display:flex; align-items:center; gap:6px; color:#60a5fa;">
                                    总审核量:
                                </span>
                                <b style="color:#ffffff;">${totalVal} 单</b>
                            </div>`;
                    html += `<div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
                                <span style="display:flex; align-items:center; gap:6px; color:#f43f5e;">
                                    <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#f43f5e;"></span>
                                    预设目标:
                                </span>
                                <b style="color:#ffffff;">${targetVal} 单 ${statusText}</b>
                            </div>`;
                    return html;
                }
            },
            legend: {
                show: true,
                data: ['初审数量', '复审数量', '预设目标'],
                textStyle: {
                    color: '#64748b',
                    fontSize: 10,
                    fontFamily: 'inherit'
                },
                top: '0%',
                right: '4%'
            },
            grid: {
                left: '3%',
                right: '5%',
                bottom: '6%',
                top: '18%',
                containLabel: true
            },
            xAxis: {
                type: 'category',
                data: labels,
                axisLine: {
                    lineStyle: {
                        color: 'rgba(255, 255, 255, 0.08)'
                    }
                },
                axisLabel: {
                    color: '#64748b',
                    fontSize: 10,
                    margin: 12
                }
            },
            yAxis: {
                type: 'value',
                minInterval: 1,
                axisLine: { show: false },
                splitLine: {
                    lineStyle: {
                        color: 'rgba(255, 255, 255, 0.03)'
                    }
                },
                axisLabel: {
                    color: '#64748b',
                    fontSize: 10
                }
            },
            series: [
                {
                    name: '初审数量',
                    type: 'bar',
                    stack: 'weekly',
                    barWidth: '35%',
                    itemStyle: {
                        color: '#3b82f6'
                    },
                    data: firstRoundValues
                },
                {
                    name: '复审数量',
                    type: 'bar',
                    stack: 'weekly',
                    barWidth: '35%',
                    itemStyle: {
                        color: '#a855f7',
                        borderRadius: [4, 4, 0, 0]
                    },
                    data: reworkValues
                },
                {
                    name: '预设目标',
                    type: 'line',
                    symbol: 'circle',
                    symbolSize: 6,
                    itemStyle: {
                        color: '#f43f5e'
                    },
                    lineStyle: {
                        color: '#f43f5e',
                        width: 2,
                        type: 'dashed'
                    },
                    data: targetValues
                }
            ]
        };

        chartInstance.setOption(option);

        if (resizeHandler) {
            window.removeEventListener('resize', resizeHandler);
        }
        resizeHandler = () => {
            if (chartInstance) chartInstance.resize();
        };
        window.addEventListener('resize', resizeHandler);
    };

        const startHelper = () => {


// ===== bootstrap.js =====
﻿        init();
        startBackgroundRefresh();
        setInterval(init, 2000);
    };

    if (document.readyState === 'complete') {
        startHelper();
    } else {
        window.addEventListener('load', startHelper);
    }
})();

})();
