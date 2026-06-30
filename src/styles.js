    // 动态注入 Google Fonts 字体
    const fontLink = document.createElement('link');
    fontLink.rel = 'stylesheet';
    fontLink.href = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap';
    document.head.appendChild(fontLink);

    // 样式注入 (UI 3.4)
    GM_addStyle(`
        /* 悬浮球容器样式 */
        #sj-stats-float-btn {
            position: fixed;
            bottom: 24px;
            right: 24px;
            background: rgba(15, 23, 42, 0.95);
            backdrop-filter: blur(12px);
            border: 1px solid rgba(59, 130, 246, 0.4);
            box-shadow: 0 4px 20px rgba(59, 130, 246, 0.25);
            color: #3b82f6;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            z-index: 99999;
            transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            user-select: none;
            box-sizing: border-box;
            overflow: hidden;
            white-space: nowrap;
        }

        /* 迷你模式 */
        #sj-stats-float-btn.sj-hud-min {
            width: 56px;
            height: 56px;
            border-radius: 50%;
            overflow: visible;
        }
        #sj-stats-float-btn.sj-hud-min:hover {
            transform: scale(1.1) translateY(-3px);
            border-color: #60a5fa;
            box-shadow: 0 8px 30px rgba(59, 130, 246, 0.5);
            color: #60a5fa;
        }

        /* 展开 HUD 状态条模式 */
        #sj-stats-float-btn.sj-hud-exp {
            width: auto;
            height: 38px;
            border-radius: 19px;
            padding: 0 16px;
            gap: 12px;
            min-width: 290px;
            overflow: hidden;
        }
        #sj-stats-float-btn.sj-hud-exp:hover {
            border-color: #60a5fa;
            box-shadow: 0 6px 24px rgba(59, 130, 246, 0.45);
        }

        #sj-stats-float-btn.sj-dragging {
            transition: none !important;
            cursor: grabbing !important;
            transform: none !important;
        }
        #sj-stats-float-btn svg {
            width: 20px;
            height: 20px;
            fill: currentColor;
        }

        /* HUD 文本与样式 */
        .sj-hud-text {
            font-size: 11.5px;
            color: #cbd5e1;
            font-weight: 500;
        }
        .sj-hud-divider {
            color: rgba(255, 255, 255, 0.12);
            font-weight: 300;
        }

        /* 进度徽标样式 */
        #sj-stats-badge {
            position: absolute;
            top: -5px;
            right: -5px;
            background: rgba(9, 13, 22, 0.95);
            border: 1px solid rgba(59, 130, 246, 0.5);
            box-shadow: 0 0 10px rgba(59, 130, 246, 0.3);
            color: #3b82f6;
            font-size: 10px;
            font-weight: 700;
            padding: 1px 5px;
            border-radius: 10px;
            pointer-events: none;
            white-space: nowrap;
            display: none;
            transition: all 0.3s ease;
            font-family: 'Plus Jakarta Sans', sans-serif;
            z-index: 100000;
        }
        #sj-stats-badge.met {
            border-color: rgba(16, 185, 129, 0.6);
            color: #10b981;
            box-shadow: 0 0 12px rgba(16, 185, 129, 0.45);
        }

        /* 模态框遮罩 */
        #sj-stats-modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(2, 6, 23, 0.75);
            backdrop-filter: blur(12px);
            z-index: 100000;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.3s ease;
        }
        #sj-stats-modal-overlay.active {
            opacity: 1;
            pointer-events: auto;
        }

        /* 模态框卡片 (暗黑玻璃拟态) */
        #sj-stats-card {
            background: #090d16;
            color: #f1f5f9;
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 20px;
            width: 720px;
            max-width: 95%;
            max-height: 90vh;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 50px rgba(59, 130, 246, 0.04);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
            transform: scale(0.92);
            transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        #sj-stats-modal-overlay.active #sj-stats-card {
            transform: scale(1);
        }

        /* 头部设计 */
        .sj-card-header {
            background: linear-gradient(180deg, rgba(255,255,255,0.02) 0%, transparent 100%);
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
            padding: 20px 24px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            position: relative;
        }
        .sj-card-title {
            margin: 0;
            font-size: 17px;
            font-weight: 700;
            background: linear-gradient(135deg, #ffffff 0%, #94a3b8 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            letter-spacing: 0.5px;
        }
        .sj-card-close {
            background: none;
            border: none;
            color: #475569;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 4px;
            border-radius: 6px;
            transition: all 0.2s;
        }
        .sj-card-close:hover {
            background: rgba(255, 255, 255, 0.05);
            color: #ffffff;
        }
        .sj-card-close svg {
            width: 18px;
            height: 18px;
            fill: currentColor;
        }

        /* 日期选择器容器 */
        .sj-date-picker-bar {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            background: rgba(255, 255, 255, 0.01);
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
            padding: 12px 24px;
        }
        .sj-date-btn {
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 8px;
            padding: 7px 14px;
            font-size: 13px;
            font-weight: 600;
            color: #94a3b8;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 4px;
            transition: all 0.2s;
            user-select: none;
        }
        .sj-date-btn:hover:not(:disabled) {
            background: rgba(255, 255, 255, 0.08);
            border-color: rgba(255, 255, 255, 0.2);
            color: #ffffff;
        }
        .sj-date-btn:disabled {
            opacity: 0.2;
            cursor: not-allowed;
        }
        .sj-date-btn svg {
            width: 14px;
            height: 14px;
            fill: currentColor;
        }
        .sj-date-input {
            border: 1px solid rgba(255, 255, 255, 0.10);
            border-radius: 8px;
            padding: 6px 12px;
            font-size: 13px;
            font-weight: 600;
            color: #ffffff;
            outline: none;
            background: rgba(15, 23, 42, 0.6);
            cursor: pointer;
            text-align: center;
            font-family: inherit;
            color-scheme: dark;
            transition: border-color 0.2s;
        }
        .sj-date-input:focus {
            border-color: #3b82f6;
        }

        /* 内容区域 */
        .sj-card-body {
            padding: 24px;
            overflow-y: auto;
            color: #cbd5e1;
            display: flex;
            flex-direction: column;
            gap: 24px;
        }

        /* 自定义窄滚动条 */
        .sj-card-body::-webkit-scrollbar {
            width: 6px;
        }
        .sj-card-body::-webkit-scrollbar-track {
            background: transparent;
        }
        .sj-card-body::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.08);
            border-radius: 3px;
        }
        .sj-card-body::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, 0.18);
        }

        /* 统计区块 (高品质卡片) */
        .sj-stats-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 16px;
        }
        .sj-stats-box {
            border-radius: 16px;
            padding: 20px 16px;
            text-align: center;
            position: relative;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 6px;
            transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .sj-stats-box::before {
            content: '';
            position: absolute;
            top: 0; left: 0; width: 100%; height: 100%;
            background: linear-gradient(180deg, rgba(255,255,255,0.02) 0%, transparent 100%);
            pointer-events: none;
        }
        .sj-box-blue {
            background: rgba(15, 23, 42, 0.45);
            border: 1px solid rgba(59, 130, 246, 0.15);
            backdrop-filter: blur(8px);
        }
        .sj-box-blue:hover {
            border-color: rgba(59, 130, 246, 0.45);
            box-shadow: 0 12px 30px rgba(59, 130, 246, 0.12);
            transform: translateY(-3px);
        }
        .sj-box-purple {
            background: rgba(15, 23, 42, 0.45);
            border: 1px solid rgba(168, 85, 247, 0.15);
            backdrop-filter: blur(8px);
        }
        .sj-box-purple:hover {
            border-color: rgba(168, 85, 247, 0.45);
            box-shadow: 0 12px 30px rgba(168, 85, 247, 0.12);
            transform: translateY(-3px);
        }
        .sj-box-amber {
            background: rgba(15, 23, 42, 0.45);
            border: 1px solid rgba(245, 158, 11, 0.15);
            backdrop-filter: blur(8px);
        }
        .sj-box-amber:hover {
            border-color: rgba(245, 158, 11, 0.45);
            box-shadow: 0 12px 30px rgba(245, 158, 11, 0.12);
            transform: translateY(-3px);
        }
        .sj-stats-box-label {
            font-size: 11.5px;
            color: #64748b;
            font-weight: 600;
            letter-spacing: 0.5px;
        }
        .sj-stats-box-value {
            font-size: 32px;
            font-weight: 700;
            line-height: 1;
        }
        .sj-text-blue { color: #3b82f6; text-shadow: 0 0 15px rgba(59, 130, 246, 0.3); }
        .sj-text-purple { color: #a855f7; text-shadow: 0 0 15px rgba(168, 85, 247, 0.3); }
        .sj-text-amber { color: #f59e0b; text-shadow: 0 0 15px rgba(245, 158, 11, 0.3); }

        /* 图表容器 */
        .sj-chart-wrapper {
            position: relative;
            background: rgba(255, 255, 255, 0.01);
            border: 1px solid rgba(255, 255, 255, 0.04);
            border-radius: 16px;
            padding: 16px 12px 10px 12px;
        }
        .sj-chart-title {
            font-size: 13px;
            font-weight: 600;
            margin-bottom: 4px;
            margin-left: 8px;
            color: #94a3b8;
        }
        #sj-stats-chart-div {
            width: 100%;
            height: 200px;
        }

        /* 列表明细样式 */
        .sj-details-wrapper {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .sj-details-title {
            font-size: 13px;
            font-weight: 600;
            color: #94a3b8;
        }
        .sj-details-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
        }
        .sj-details-table th, .sj-details-table td {
            padding: 11px 16px;
            text-align: left;
        }
        .sj-details-table th {
            background: rgba(255, 255, 255, 0.02);
            color: #64748b;
            font-weight: 600;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            font-size: 12px;
        }
        .sj-details-table td {
            border-bottom: 1px solid rgba(255, 255, 255, 0.03);
            color: #cbd5e1;
        }
        .sj-details-table tr:hover {
            background: rgba(255, 255, 255, 0.02);
        }

        /* 加载动画 */
        .sj-loading-overlay {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 60px 0;
        }
        .sj-spinner {
            border: 3px solid rgba(255, 255, 255, 0.04);
            width: 32px;
            height: 32px;
            border-radius: 50%;
            border-left-color: #3b82f6;
            animation: sj-spin 0.8s linear infinite;
            margin-bottom: 16px;
        }
        @keyframes sj-spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        /* 选项卡切换样式 (v1.8) */
        .sj-tab-item {
            user-select: none;
            position: relative;
            padding: 10px 4px;
            font-size: 13px;
            font-weight: 600;
            color: #64748b;
            border-bottom: 2px solid transparent;
            cursor: pointer;
            transition: all 0.2s;
            height: 100%;
            display: flex;
            align-items: center;
            box-sizing: border-box;
        }
        .sj-tab-item:hover {
            color: #f1f5f9;
        }
                .sj-tab-item.active {
            color: #3b82f6;
            border-bottom-color: #3b82f6;
        }

        /* Q10 & Q15 下方的 AI 字幕轻量提示 */
        .sj-stt-tip-box {
            background: transparent !important;
            border: none !important;
            border-radius: 0 !important;
            padding: 0 !important;
            margin: 4px 0 6px !important;
            color: #64748b !important;
            font-family: system-ui, -apple-system, sans-serif !important;
            font-size: 11px !important;
            line-height: 1.25 !important;
            box-shadow: none !important;
            animation: sj-fade-in 0.3s ease;
        }
        .sj-stt-highlight-price {
            background-color: rgba(234, 179, 8, 0.2) !important;
            color: #facc15 !important;
            padding: 1px 4px !important;
            border-radius: 3px !important;
            font-weight: bold !important;
            border: 1px solid rgba(234, 179, 8, 0.4) !important;
        }
        .sj-stt-highlight-stock {
            background-color: rgba(168, 85, 247, 0.2) !important;
            color: #c084fc !important;
            padding: 1px 4px !important;
            border-radius: 3px !important;
            font-weight: bold !important;
            border: 1px solid rgba(168, 85, 247, 0.4) !important;
        }

        /* 题目自动折叠样式 */
        .sj-collapsed-card {
            height: 38px !important;
            overflow: hidden !important;
            opacity: 0.65;
            position: relative;
            border: 1px dashed #dcdfe6 !important;
            background-color: #f5f7fa !important;
            transition: all 0.2s ease-in-out;
        }
        .sj-collapsed-card:hover {
            opacity: 1;
            background-color: #ecf5ff !important;
            border-color: #c6e2ff !important;
        }
        .sj-collapsed-card * {
            pointer-events: none !important;
        }
        .sj-collapsed-card .sj-collapse-toggle-btn {
            pointer-events: auto !important;
        }

        /* 禁用说明信息的鼠标悬停，从而拦截其 Popover 弹窗 */
        .question-detail-text.el-popover__reference,
        .question-detail-text,
        .question-detail {
            pointer-events: none !important;
            user-select: none !important;
        }
    `);
    // 全局今日数据缓存 (v2.8)
