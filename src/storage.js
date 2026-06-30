    // 判断是否为初审工单 (v3.6)
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

