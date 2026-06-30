# 🤖 爱零工审单数据助手（模块化开发版）

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tampermonkey](https://img.shields.io/badge/Tampermonkey-Supported-green.svg)](https://www.tampermonkey.net/)
[![Platform](https://img.shields.io/badge/Platform-Slicejobs-orange.svg)](http://admin2.slicejobs.com/)

这是一款面向 **“爱零工（Slicejobs）”** 平台审核员的多功能浏览器辅助脚本。本项目采用**模块化开发架构**，将核心功能拆分到不同的模块文件中，便于代码维护与二次开发。

---

## ⚙️ 极速安装与更新 (首选方式)

1.  在浏览器安装 **Tampermonkey (油猴)** 扩展。
2.  点击下方链接直接安装或自动更新至最新版本：
    *   👉 **[点此直链安装/更新《爱零工审单数据助手》](https://raw.githubusercontent.com/3169657175/slicejobs-helper/master/dist/slicejobs.user.js)**
    *(点击后油猴会自动拦截并弹出安装/更新确认页面，点击“安装”或“更新”即可)*
3.  匹配域名：`*://admin2.slicejobs.com/*`

---

## 🌟 核心功能特性

### 🎙️ 1. AI 语音识别 (STT) 模块
*   **智能供应商调度**：针对音频长度，智能选择 SiliconFlow 或 Groq 进行识别。
*   **幻觉循环文本过滤**：内置算法，过滤并剔除语音识别模型产生的编造和无意义循环重复文本。
*   **业务线索提取**：智能提取录音中的价格、库存等关键业务线索并高亮展示。
*   **原生字幕融合**：自动抓取并融合平台已展示的原生字幕，免去重复识别开销。

### ⚡ 2. 自动审核与录音助手
*   **一键通过 (Alt + A)**：全自动完成合规判题并直接提交。
*   **录音自动播放**：进入审核页后自动定位并播放第一个录音卡片，省去手动寻找和点击播放的步骤。

### 📊 3. 效率统计大屏与 HUD
*   **数据可视化**：支持展示小时产出柱状图、近 7 日趋势折线图，支持 CSV 数据报表导出。
*   **精细时速**：基于实际审核时间戳的间隔累加算法，真实计算手速，排除非工作时间的稀释。

---

## 📁 项目目录结构

整个项目被拆分为以下模块：

*   `src/header.js` — 油猴脚本元信息与匹配域名。
*   `src/interceptor.js` — 网络拦截器，用于捕获页面 XHR/fetch 请求中的音频。
*   `src/storage.js` — 全局变量共享及 `localStorage` 存取。
*   `src/styles.js` — 整个插件的 CSS 样式定义。
*   `src/hud.js` — 悬浮 HUD 状态条渲染。
*   `src/auto-review.js` — 自动判题流程与录音辅助控制。
*   `src/stt.js` — 语音识别（STT）核心逻辑、幻觉过滤与 UI 渲染。
*   `src/stats.js` — 统计面板图表（ECharts）绘制与 CSV 导出。
*   `src/bootstrap.js` — 插件初始化挂载和背景刷新入口。

---

## 🔧 开发者编译与构建

如果您想参与本项目功能的开发与修改，请遵循以下流程：

### 1. 克隆仓库
```bash
git clone https://github.com/3169657175/slicejobs-helper.git
cd slicejobs-helper
```

### 2. 开发原则
请只修改 `src/` 目录下的相应模块小文件，**请勿直接修改 `dist/` 下的打包大文件**。

### 3. 本地打包构建
修改完成后，在项目根目录下运行打包脚本进行编译合并：
```bash
node build.js
```
执行后，最新的代码会被自动打包并输出到 `dist/slicejobs.user.js` 中。

### 4. 发布与自动升级
1. 修改 `src/header.js` 中的 `@version` 版本号。
2. 运行 `node build.js` 进行重新打包。
3. 提交并推送到 GitHub 远程仓库：
   ```bash
   git add .
   git commit -m "bump: version to x.x.x"
   git push
   ```
   推送成功后，所有已安装用户的插件都会在后台检测到版本更新并自动拉取升级。

---

## 📄 许可证

本项目基于 [MIT](LICENSE) 许可证开源。
