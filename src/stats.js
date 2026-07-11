        if (typeof autoReviewInit === 'function') {
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
        const isHomeOfficeMode = extraHours.filter(h => h !== 12).length > 0;
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
        const isWeeklyHomeOfficeMode = extraHours.filter(h => h !== 12).length > 0;
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
