# 🤖 给 AI 助手的工作说明

> **你正在看的这个项目是"爱零工审单数据助手"油猴插件的模块化开发目录。**
> **如果你是刚开新对话窗口的 AI，请先读完这份说明再开始工作。**

---

## ⚙️ 极速安装与更新 (首选方式)

1.  在浏览器安装 **Tampermonkey (油猴)** 扩展。
2.  点击下方链接直接安装或自动更新至最新版本：
    *   👉 **[点此直链安装/更新《爱零工审单数据助手》](https://raw.githubusercontent.com/3169657175/slicejobs-helper/master/dist/slicejobs.user.js)**
    *(点击后油猴会自动拦截并弹出安装/更新确认页面，点击“安装”或“更新”即可)*
3.  匹配域名：`*://admin2.slicejobs.com/*`

---

## ⚠️ 重要：不要直接读 dist/ 下的大文件

`dist/slicejobs.user.js` 有 **5000+ 行、245KB**，直接读取会浪费大量 context。

**正确的工作方式：**
1. 用户描述问题 → 判断涉及哪个模块 → 只读对应的 `src/*.js`
2. 修改 `src/*.js` 小文件
3. 运行 `node build.js` 重新打包 → 自动更新 `dist/slicejobs.user.js`
4. 用户把 `dist/slicejobs.user.js` 更新到油猴

---

## 📁 src/ 模块地图

### `header.js` · 17 行 · 插件元信息
油猴脚本头，包含版本号、匹配域名、@grant 权限、@require 外部库。
**改这里**：升级版本号、添加新 @connect 域名、修改匹配规则。

---

### `interceptor.js` · 61 行 · 网络拦截器
在页面最早期拦截所有 XHR 和 fetch 请求，从响应体中提取音频 CDN URL（`sjaudiopub.slicejobs.com`），并调用 `sttSilentProcess` 触发后台预识别。
**改这里**：音频 URL 匹配正则、拦截逻辑、去重策略。
⚠️ 这个模块在 IIFE 内最先执行，顺序不能调整。

---

### `storage.js` · 201 行 · 全局状态 + 数据存储
包含两部分：

**全局变量**（所有其他模块共享）：
- `currentDate` — 当前查看的日期
- `chartInstance` — ECharts 实例
- `currentDayStats` / `currentWeeklyStats` — 统计缓存
- `currentTab` — 当前标签（daily/weekly）
- `queryCache` — API 请求内存缓存
- `autoRefreshInterval` — 自动刷新定时器
- `sttCurrentOrderTranscripts` — STT 转写结果缓存
- `sttManuallyExpanded` — 手动展开的题目集合

**localStorage 读写函数**：
- `getTargetForDate / setTargetForDate` — 每日审核目标
- `getObservedIdsForDate / setObservedIdsForDate` — 已观测工单 ID
- `getMaxObservedForDate / setMaxObservedForDate` — 最高观测量
- `sanitizeAllObservedIds` — 自愈净化跨天污染数据

---

### `styles.js` · 508 行 · 全部 CSS 样式
包含 Google Fonts 注入 + 整个插件的所有 `GM_addStyle` CSS：
- 悬浮 HUD 球（min 模式 / exp 展开模式）
- 统计模态框（玻璃拟态暗黑风格）
- ECharts 图表容器
- STT 字幕提示框、高亮标签
- 题目折叠/展开动画
- 加载动画、选项卡

**改这里**：任何视觉样式调整。

---

### `hud.js` · 245 行 · 悬浮 HUD 状态条
悬浮在页面右下角的快速统计显示器：
- `updateFloatingUI(records)` — 根据今日数据更新 HUD 显示（显示初审数/目标/时速）
- `toggleHudMode()` — 在迷你圆球和展开状态条之间切换（双击触发）
- `initFloatBadge()` — 页面加载时静默拉取今日数据初始化徽标
- `startAutoRefresh()` / `stopAutoRefresh()` — 面板打开时 15 秒刷新
- `startBackgroundRefresh()` — 面板关闭时 30 秒后台刷新 HUD

**改这里**：HUD 显示内容、刷新频率、confetti 洒花逻辑。

---

### `auto-review.js` · 628 行 · 自动审核 + 录音助手

**一键通过审核（Alt+A 快捷键）**：
- `autoReviewPassAllQuestions()` — 自动点击所有题目的最高星级
- `autoReviewRunFullFlow()` — 完整流程：判题 → 提交 → 下一单
- `autoReviewCreatePanel()` — 右下角控制面板 UI（可拖拽）
- `autoReviewToast(msg)` — 操作反馈浮层提示

**录音自动打开助手**：
- `sjRecordingOpenFirst()` — 自动找到第一个录音卡并打开播放器
- `sjRecordingAutoOpenForOrder()` — 进入审核页自动触发打开录音
- `sjRecordingCreateOpenButton()` — 控制面板内"打开录音"按钮

**改这里**：自动审核流程逻辑、控制面板 UI、快捷键行为。

---

### `stt.js` · 1816 行 · AI 语音识别全模块

这是最大的模块，包含所有 `stt*` 前缀函数：

**API 与供应商管理**：
- `sttChooseProviders()` — 根据音频时长智能选择供应商（SiliconFlow < 6分钟，Groq > 6分钟）
- `sttTranscribeWithFallback()` — 依次尝试供应商，无业务信号则 fallback
- `sttBuildFormData()` — 构建 Whisper API 请求（含中文 prompt、temperature=0）

**结果处理**：
- `parseApiResponse()` — 解析 verbose_json 响应为 segments 数组
- `sttIsHallucination()` — 检测幻觉循环文本（模型编造的无意义重复）
- `sttHasUsefulBusinessSignal()` — 检测是否含业务词（脉动/电解质/库存/价格等）
- `sttBuildBusinessClues()` — 提取价格线索、库存线索用于展示

**UI 渲染**：
- `sttRenderSuccess()` — 渲染转写成功结果（带时间轴高亮）
- `sttRenderError()` — 渲染失败提示
- `sttRenderKeyPrompt()` — 渲染 API Key 输入框
- `sttRenderNativeReuse()` — 渲染"命中原生字幕"提示

**原生字幕**：
- `sttGetNativeSubtitleSegments()` — 从 DOM 的 `<li>` 列表抓取已展示字幕
- `sttFindNativeSubtitlesInVue()` — ⚠️ 已禁用（返回 []），原为 Vue 内存扫描

**主流程**：
- `sttProcess(audio, dialogBody, forceAi)` — 单个音频的完整识别流程
- `sttSilentProcess(url)` — 后台静默预识别（无 UI，结果缓存备用）
- `sttAutoScanPage()` — 进入审核页后自动扫描所有题目音频
- `sttInit()` — STT 模块初始化，注册 MutationObserver 监听题目变化

**改这里**：识别逻辑、幻觉过滤、业务关键词、UI 渲染、原生字幕检测。

---

### `stats.js` · 1788 行 · 统计数据 + 图表

**数据获取**：
- `fetchRecordsForDate(token, dateStr)` — 分页拉取指定日期的全部审核记录
- `loadStats()` — 统计面板打开时的主入口，处理日期选择、加载动画、tab 切换

**日统计渲染**：
- `renderStats(records, yesterdayRecords)` — 渲染当日统计面板
  - 自动检测加班模式（19点后有记录则延伸时间轴到 19、20、21 点）
  - 小时粒度数据表（初审 / 复审 / 合计）
  - 目标设置 popover
- `initEChart(hourlyData, ...)` — 渲染每小时初审/复审柱状图（带昨日对比）

**周统计渲染**：
- `renderWeeklyStats(records)` — 渲染本周每日统计折线图
- `initWeeklyChart(labels, ...)` — 渲染周趋势 ECharts 图

**工具函数**：
- `formatDate(date)` — 格式化为 YYYY-MM-DD
- `isTodayRange(endTime)` — 判断时间戳是否属于今日

**改这里**：统计面板 UI、小时归并规则、加班模式判断、CSV 导出、图表配置。

---

### `bootstrap.js` · 11 行 · 启动入口

```js
const init = () => { ... }   // 注册面板按钮、键盘快捷键、路由监听
const startHelper = () => {
    init();
    startBackgroundRefresh();
    setInterval(init, 2000);  // 每 2 秒重新检测并挂载 UI
};
```

**改这里**：初始化顺序、启动时机、全局事件注册。

---

## 🔧 打包与构建

```bash
# 在 C:\Users\niu\Desktop\插件\ 目录下执行：
node build.js
```
执行后会将 `src/*.js` 文件打包构建并输出到 `dist/slicejobs.user.js`。



---

## 🚀 开发者版本升级

当您修改完模块后，若需要升级版本：
1.  先修改 `src/header.js` 中的 `@version`。
2.  执行构建：
    ```bash
    node build.js
    ```
3.  提交并推送：
    ```bash
    git add .
    git commit -m "bump: version to x.x.x"
    git push
    ```
    推送成功后，用户的油猴插件会在后台检测并自动更新该脚本！

---

## 🗺️ 问题 → 模块 速查表

| 用户描述的问题 | 对应模块 |
|--------------|---------|
| 样式、颜色、布局、字体 | `styles.js` |
| 悬浮 HUD 显示不对、刷新频率 | `hud.js` |
| Alt+A 自动审核、控制面板 | `auto-review.js` |
| 打开录音按钮、录音播放器 | `auto-review.js` |
| AI 识别结果不对、幻觉、fallback | `stt.js` |
| 原生字幕命中/未命中 | `stt.js` |
| 识别供应商切换（Groq/SiliconFlow）| `stt.js` |
| 统计数字不对、小时归并规则 | `stats.js` |
| 加班模式时间轴 | `stats.js` |
| ECharts 图表样式 | `stats.js` |
| CSV 导出 | `stats.js` |
| localStorage 存取、数据污染 | `storage.js` |
| 音频 URL 没有被捕获 | `interceptor.js` |
| 版本号、@match 域名 | `header.js` |
| 启动顺序、初始化 | `bootstrap.js` |
