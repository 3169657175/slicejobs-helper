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

    function autoReviewGetNextOrderButton() {
        return Array.from(document.querySelectorAll('button')).find(
            (b) => b.textContent.trim() === '审核下一单'
        );
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
            autoReviewClickEl(confirmBtn);

            // 等待跳转下一单按钮出现（极速轮询，最大等待4秒）
            let nextBtn = null;
            for (let i = 0; i < 200; i++) { // 200 * 20ms = 4s
                nextBtn = autoReviewGetNextOrderButton();
                if (nextBtn) break;
                await autoReviewSleep(20);
            }

            // ③ 去掉固定 400ms，检测到按钮存在直接跳转
            nextBtn = autoReviewGetNextOrderButton();
            if (nextBtn) {
                autoReviewToast('审核已提交，正在跳转下一单...');
                autoReviewClickEl(nextBtn);
            } else {
                autoReviewToast('审核可能已提交，但未找到"审核下一单"按钮，请手动确认', true);
            }
        } catch (err) {
            console.error(err);
            autoReviewToast('执行出错: ' + err.message, true);
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

        const panel = document.createElement('div');
        panel.id = 'sj-control-panel';
        panel.style.position = 'fixed';
        panel.style.top = '50%';
        panel.style.right = '28px';
        panel.style.transform = 'translateY(-50%)';
        panel.style.zIndex = 999998;
        panel.style.display = 'flex';
        panel.style.flexDirection = 'column';
        panel.style.gap = '8px';
        panel.style.padding = '10px 12px 12px';
        panel.style.minWidth = '150px';
        panel.style.background = 'linear-gradient(180deg, rgba(15,23,42,.96), rgba(15,23,42,.92))';
        panel.style.border = '1px solid rgba(148,163,184,.18)';
        panel.style.borderRadius = '14px';
        panel.style.boxShadow = '0 16px 36px rgba(15,23,42,.28)';
        panel.style.backdropFilter = 'blur(10px)';
        panel.style.userSelect = 'none';

        const header = document.createElement('div');
        header.style.color = '#94a3b8';
        header.style.fontSize = '12px';
        header.style.fontWeight = '700';
        header.style.lineHeight = '16px';
        header.style.cursor = 'grab';
        header.style.paddingLeft = '10px';
        header.style.position = 'relative';
        header.innerHTML = '<span style="position:absolute;left:0;top:5px;width:6px;height:6px;border-radius:999px;background:#10b981;box-shadow:0 0 8px rgba(16,185,129,.7);"></span>AI 审核辅助';
        panel.appendChild(header);

        const makePanelBtn = (id, html, bg, hoverBg, title) => {
            const panelBtn = document.createElement('button');
            panelBtn.id = id;
            panelBtn.innerHTML = html;
            panelBtn.title = title || '';
            panelBtn.style.width = '100%';
            panelBtn.style.height = '34px';
            panelBtn.style.border = 'none';
            panelBtn.style.borderRadius = '9px';
            panelBtn.style.color = '#fff';
            panelBtn.style.fontSize = '14px';
            panelBtn.style.fontWeight = '800';
            panelBtn.style.cursor = 'pointer';
            panelBtn.style.display = 'flex';
            panelBtn.style.alignItems = 'center';
            panelBtn.style.justifyContent = 'center';
            panelBtn.style.background = bg;
            panelBtn.style.boxShadow = '0 6px 14px rgba(0,0,0,.14)';
            panelBtn.style.transition = 'transform .16s ease, background .16s ease, box-shadow .16s ease';
            panelBtn.addEventListener('mouseenter', () => {
                if (panelBtn.disabled) return;
                panelBtn.style.transform = 'translateY(-1px)';
                panelBtn.style.background = hoverBg;
                panelBtn.style.boxShadow = '0 8px 18px rgba(0,0,0,.22)';
            });
            panelBtn.addEventListener('mouseleave', () => {
                panelBtn.style.transform = 'translateY(0)';
                panelBtn.style.background = bg;
                panelBtn.style.boxShadow = '0 6px 14px rgba(0,0,0,.14)';
            });
            panel.appendChild(panelBtn);
            return panelBtn;
        };

        const passBtn = makePanelBtn(
            'sj-auto-review-btn',
            '<span style="font-size:15px;margin-right:6px;">✓</span>一键通过',
            'linear-gradient(135deg,#10b981,#059669)',
            'linear-gradient(135deg,#059669,#047857)',
            '快捷键 Alt+A'
        );
        passBtn.addEventListener('click', () => autoReviewRunFullFlow());

        const audioBtn = makePanelBtn(
            'sj-open-recording-btn',
            '<span style="font-size:15px;margin-right:6px;">♫</span>打开录音',
            'linear-gradient(135deg,#3b82f6,#2563eb)',
            'linear-gradient(135deg,#2563eb,#1d4ed8)',
            '快速打开本单第一个录音'
        );
        audioBtn.addEventListener('click', () => sjRecordingOpenFirst(true));

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

