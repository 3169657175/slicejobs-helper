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

        const displayHours = [9, 10, 11, 13, 14, 15, 16, 17];
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
