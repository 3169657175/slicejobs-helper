    // =========================================================================
    // Aliyun OSS Image Optimizer (v4.1.0)
    // =========================================================================

    function sjOptimizeImageUrlForPreview(url, width = 1000) {
        if (!url || typeof url !== 'string') return url;
        if (!url.includes('slicejobs.com') && !url.includes('aliyuncs.com')) return url;
        if (url.startsWith('data:') || url.startsWith('blob:')) return url;

        try {
            const u = new URL(url);
            const process = u.searchParams.get('x-oss-process');
            if (process) {
                if (process.includes('image/resize')) {
                    // Replace existing resize settings to use our optimized width
                    let newProcess = process.replace(/w_\d+/g, `w_${width}`).replace(/h_\d+/g, '');
                    newProcess = newProcess.replace(/,+/g, ',').replace(/,$/, '').replace(/,color_[0-9a-fA-F]+/, '').replace(/m_pad/, 'm_lfit');
                    if (!newProcess.includes('/format,webp')) newProcess += '/format,webp';
                    if (!newProcess.includes('/quality,q_80')) newProcess += '/quality,q_80';
                    u.searchParams.set('x-oss-process', newProcess);
                } else {
                    u.searchParams.set('x-oss-process', `image/resize,w_${width}/format,webp/quality,q_80`);
                }
            } else {
                u.searchParams.set('x-oss-process', `image/resize,w_${width}/format,webp/quality,q_80`);
            }
            return u.toString();
        } catch (e) {
            if (url.includes('?')) {
                if (url.includes('x-oss-process=')) {
                    return url.replace(/x-oss-process=[^&]+/, `x-oss-process=image/resize,w_${width}/format,webp/quality,q_80`);
                } else {
                    return url + `&x-oss-process=image/resize,w_${width}/format,webp/quality,q_80`;
                }
            } else {
                return url + `?x-oss-process=image/resize,w_${width}/format,webp/quality,q_80`;
            }
        }
    }

    function sjGetOriginalImageUrl(url) {
        if (!url) return '';
        try {
            const u = new URL(url);
            u.searchParams.delete('x-oss-process');
            return u.toString();
        } catch (e) {
            return url.replace(/[\?&]x-oss-process=[^&]+/, '').replace(/\?$/, '');
        }
    }

    function sjOptimizeAllViewerImages(viewerNode) {
        const imgs = viewerNode.querySelectorAll('img');
        imgs.forEach((img) => {
            const src = img.getAttribute('src');
            if (src && !src.startsWith('data:') && !src.startsWith('blob:')) {
                if (img.dataset.sjOriginalLoaded === 'true') return;
                if (src.includes('format,webp') && src.includes('quality,q_80')) return;
                
                const optimizedSrc = sjOptimizeImageUrlForPreview(src, 1000);
                if (optimizedSrc !== src) {
                    img.setAttribute('src', optimizedSrc);
                }
            }
        });
    }

    function sjInjectOriginalImageButton(viewerNode) {
        if (viewerNode.querySelector('#sj-load-original-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'sj-load-original-btn';
        btn.style.cssText = `
            position: absolute;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 999999;
            padding: 8px 18px;
            background: rgba(15, 23, 42, 0.75);
            color: #f8fafc;
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 20px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            font-family: system-ui, -apple-system, sans-serif;
            backdrop-filter: blur(8px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            transition: all 0.2s ease;
        `;
        btn.innerText = '🔍 加载超清原图 (2MB)';

        btn.addEventListener('mouseenter', () => {
            btn.style.background = 'rgba(15, 23, 42, 0.9)';
            btn.style.borderColor = 'rgba(255, 255, 255, 0.4)';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.background = 'rgba(15, 23, 42, 0.75)';
            btn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
        });

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const activeImg = viewerNode.querySelector('.viewer-canvas img');
            if (activeImg) {
                const currentSrc = activeImg.getAttribute('src');
                if (currentSrc) {
                    const originalSrc = sjGetOriginalImageUrl(currentSrc);
                    activeImg.dataset.sjOriginalLoaded = 'true';
                    activeImg.setAttribute('src', originalSrc);

                    btn.innerText = '✓ 已加载原图';
                    btn.style.background = 'rgba(16, 185, 129, 0.8)';
                    btn.style.borderColor = 'rgba(16, 185, 129, 0.4)';
                    btn.disabled = true;
                }
            }
        });

        viewerNode.appendChild(btn);
    }

    let sjViewerObserver = null;
    let sjBodyObserver = null;

    function sjInitImageOptimizer() {
        if (sjBodyObserver) return; // Prevent double init

        sjViewerObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'src') {
                    const img = mutation.target;
                    if (img.tagName.toLowerCase() === 'img' && img.closest('.viewer-container')) {
                        const src = img.getAttribute('src');
                        if (src && !src.startsWith('data:') && !src.startsWith('blob:')) {
                            // If a new source has been set by Viewer.js, reset original loaded state
                            const isNewLoad = !src.includes('quality,q_80');
                            if (isNewLoad) {
                                img.dataset.sjOriginalLoaded = 'false';
                                const btn = document.getElementById('sj-load-original-btn');
                                if (btn) {
                                    btn.innerText = '🔍 加载超清原图 (2MB)';
                                    btn.style.background = 'rgba(15, 23, 42, 0.75)';
                                    btn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                                    btn.disabled = false;
                                }
                            }

                            if (img.dataset.sjOriginalLoaded === 'true') {
                                return;
                            }

                            if (src.includes('format,webp') && src.includes('quality,q_80')) {
                                return;
                            }

                            const optimizedSrc = sjOptimizeImageUrlForPreview(src, 1000);
                            if (optimizedSrc !== src) {
                                img.setAttribute('src', optimizedSrc);
                            }
                        }
                    }
                }
            });
        });

        sjBodyObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType !== Node.ELEMENT_NODE) return;

                    if (node.classList.contains('viewer-container')) {
                        sjViewerObserver.observe(node, {
                            attributes: true,
                            attributeFilter: ['src'],
                            subtree: true
                        });
                        sjOptimizeAllViewerImages(node);
                        sjInjectOriginalImageButton(node);
                    }
                });
            });
        });

        sjBodyObserver.observe(document.body, {
            childList: true,
            subtree: false
        });

        // Scan in case viewer is already open at load time
        const existingViewer = document.querySelector('.viewer-container');
        if (existingViewer) {
            sjViewerObserver.observe(existingViewer, {
                attributes: true,
                attributeFilter: ['src'],
                subtree: true
            });
            sjOptimizeAllViewerImages(existingViewer);
            sjInjectOriginalImageButton(existingViewer);
        }
    }
