// ==UserScript==
// @name         爱零工审单数据助手 (SliceJobs Audit Stats Helper)
// @namespace    http://tampermonkey.net/
// @version      3.8.2
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
