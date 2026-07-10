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
        if (!document.body || document.getElementById('sj-control-panel')) return;
        document.getElementById('sj-auto-review-btn')?.remove();
        document.getElementById('sj-open-recording-btn')?.remove();
        document.getElementById('sj-open-audio-btn')?.remove();

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
            right: '20px',
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

        const skipBtn = makePanelBtn(
            'sj-skip-order-btn', '⏭', '跳过此单',
            'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
            'rgba(245, 158, 11, 0.3)'
        );
        skipBtn.title = '取消占有当前订单并进入下一单';
        skipBtn.addEventListener('click', () => sjSkipCurrentOrder(skipBtn));

        const audioBtn = makePanelBtn(
            'sj-open-recording-btn', '🎧', '打开录音',
            'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
            'rgba(59, 130, 246, 0.3)'
        );
        audioBtn.title = '快速打开本单第一个录音';
        audioBtn.addEventListener('click', () => sjRecordingOpenFirst(true));

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
            const newLeft = Math.max(0, Math.min(initialLeft + dx, window.innerWidth - rect.width));
            const newTop = Math.max(0, Math.min(initialTop + dy, window.innerHeight - rect.height));
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
            panel.style.transform = 'none';
            panel.style.left = newLeft + 'px';
            panel.style.top = newTop + 'px';
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
            button.innerHTML = '<span style="font-size:15px;margin-right:6px;">…</span>正在释放';
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
                button.innerHTML = '<span style="font-size:15px;margin-right:6px;">↷</span>跳过此单';
            }
        }
    }
