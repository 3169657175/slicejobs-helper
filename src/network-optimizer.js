    // =========================================================================
    // Network Requests & Webpack Prefetch Optimizer (v4.2.0)
    // =========================================================================

    const SJ_BLOCKED_DOMAINS = [
        'arms-retcode.aliyuncs.com',
        'retcode.alicdn.com',
        'dlswbr.baidu.com'
    ];

    function sjIsBlockedUrl(url) {
        if (!url || typeof url !== 'string') return false;
        return SJ_BLOCKED_DOMAINS.some(domain => url.includes(domain));
    }

    function sjShouldBlockDomNode(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
        const tag = node.tagName.toLowerCase();
        if (tag === 'link') {
            const rel = node.getAttribute('rel');
            const href = node.getAttribute('href') || '';
            if (rel === 'prefetch' && href.includes('/static/js/')) {
                return true;
            }
        }
        if (tag === 'script') {
            const src = node.getAttribute('src') || '';
            if (sjIsBlockedUrl(src)) {
                return true;
            }
        }
        return false;
    }

    function sjInjectPreconnect() {
        try {
            if (document.querySelector('link[href*="sjimgpub.slicejobs.com"][rel="preconnect"]')) return;
            const link = document.createElement('link');
            link.rel = 'preconnect';
            link.href = 'https://sjimgpub.slicejobs.com';
            
            // Bypass our own link-blocking DOM filters when inserting this preconnect link
            const origAppend = HTMLHeadElement.prototype.appendChild;
            if (document.head) {
                origAppend.call(document.head, link);
            }
        } catch (e) {
            console.error('[Network Optimizer] Failed to inject preconnect link:', e);
        }
    }

    let sjNetworkOptimizerInitialized = false;

    function sjInitNetworkOptimizer() {
        if (sjNetworkOptimizerInitialized) return;
        sjNetworkOptimizerInitialized = true;

        console.log('[Network Optimizer] Initializing Request & Prefetch Interceptors...');

        // 1. Hook DOM node insertion to block static prefetch links and analytics scripts
        const origAppend = Element.prototype.appendChild;
        Element.prototype.appendChild = function(newChild) {
            if (sjShouldBlockDomNode(newChild)) {
                return newChild;
            }
            return origAppend.call(this, newChild);
        };

        const origInsertBefore = Element.prototype.insertBefore;
        Element.prototype.insertBefore = function(newChild, refChild) {
            if (sjShouldBlockDomNode(newChild)) {
                return newChild;
            }
            return origInsertBefore.call(this, newChild, refChild);
        };

        // 2. Hijack fetch to block tracking endpoints
        const origFetch = window.fetch;
        if (origFetch) {
            window.fetch = function(input, initOptions, ...args) {
                const url = typeof input === 'string' ? input : (input && input.url || '');
                if (sjIsBlockedUrl(url)) {
                    console.log('[Network Optimizer] Blocked fetch request:', url);
                    return Promise.resolve(new Response('', {
                        status: 200,
                        statusText: 'OK',
                        headers: new Headers({ 'Content-Type': 'text/plain' })
                    }));
                }
                return origFetch.call(this, input, initOptions, ...args);
            };
        }

        // 3. Hijack XMLHttpRequest to block tracking endpoints
        const origOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url, ...args) {
            this._sjBlocked = sjIsBlockedUrl(url);
            this._sjUrl = url;
            return origOpen.call(this, method, url, ...args);
        };

        const origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function(...args) {
            if (this._sjBlocked) {
                console.log('[Network Optimizer] Mocking blocked XHR send:', this._sjUrl);
                setTimeout(() => {
                    Object.defineProperty(this, 'readyState', { value: 4, writable: true });
                    Object.defineProperty(this, 'status', { value: 200, writable: true });
                    Object.defineProperty(this, 'responseText', { value: '', writable: true });
                    this.dispatchEvent(new Event('readystatechange'));
                    this.dispatchEvent(new Event('load'));
                }, 5);
                return;
            }
            return origSend.call(this, ...args);
        };

        // 4. Inject preconnect header
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', sjInjectPreconnect);
        } else {
            sjInjectPreconnect();
        }
    }
