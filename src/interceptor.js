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

