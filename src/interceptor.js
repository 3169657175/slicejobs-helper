(/* @global echarts */ function() {
    'use strict';

    // ============================================================
    // 网络拦截器：监听 XHR / fetch 响应，自动捕获音频 URL（v3.8）
    // 必须在所有 STT 函数之前运行，在 Vue 发起 API 请求时即时捕获
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

        // 拦截 XMLHttpRequest
        const origOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url, ...rest) {
            this._sjUrl = url;
            this._sjMethod = method;
            return origOpen.call(this, method, url, ...rest);
        };
        const origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function(...args) {
            this.addEventListener('load', function() {
                const url = this._sjUrl || '';
                const method = this._sjMethod || 'POST';
                if (this.status === 200 && method.toUpperCase() === 'POST' && url.includes('/admin/audit_task/')) {
                    if (!url.includes('/create') && !url.includes('/get') && !url.includes('/detail') && !url.includes('/history') && !url.includes('/info')) {
                        let isSuccess = true;
                        try {
                            const resObj = JSON.parse(this.responseText);
                            if (resObj && (resObj.code !== undefined && resObj.code !== 200 && resObj.code !== 0)) {
                                isSuccess = false;
                            }
                            if (resObj && (resObj.status !== undefined && resObj.status !== 200 && resObj.status !== 0)) {
                                isSuccess = false;
                            }
                        } catch (e) {}
                        if (isSuccess) {
                            console.log('[Prefetch] 拦截到 XHR 审核成功提交，触发极速跳转:', url);
                            if (typeof sjTriggerPrefetchJump === 'function') {
                                sjTriggerPrefetchJump();
                            }
                        }
                    }
                }
                scanText(this.responseText);
            });
            return origSend.call(this, ...args);
        };

        // 拦截 fetch
        const origFetch = window.fetch;
        if (origFetch) {
            window.fetch = async function(input, initOptions, ...args) {
                const url = typeof input === 'string' ? input : (input && input.url || '');
                const method = initOptions && initOptions.method || 'GET';
                const response = await origFetch.call(this, input, initOptions, ...args);
                
                if (response.status === 200 && method.toUpperCase() === 'POST' && url.includes('/admin/audit_task/')) {
                    if (!url.includes('/create') && !url.includes('/get') && !url.includes('/detail') && !url.includes('/history') && !url.includes('/info')) {
                        let isSuccess = true;
                        try {
                            const clone = response.clone();
                            const text = await clone.text();
                            const resObj = JSON.parse(text);
                            if (resObj && (resObj.code !== undefined && resObj.code !== 200 && resObj.code !== 0)) {
                                isSuccess = false;
                            }
                            if (resObj && (resObj.status !== undefined && resObj.status !== 200 && resObj.status !== 0)) {
                                isSuccess = false;
                            }
                        } catch (e) {}
                        if (isSuccess) {
                            console.log('[Prefetch] 拦截到 fetch 审核成功提交，触发极速跳转:', url);
                            if (typeof sjTriggerPrefetchJump === 'function') {
                                sjTriggerPrefetchJump();
                            }
                        }
                    }
                }

                try {
                    const clone = response.clone();
                    clone.text().then(scanText).catch(() => {});
                } catch {}
                return response;
            };
        }
    })();

