# AIReader - 深度阅读伴侣

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![Platform](https://img.shields.io/badge/platform-Chrome_Extension-green.svg)
![Tech Stack](https://img.shields.io/badge/tech-Vanilla_JS-orange.svg)

AIReader 是一款基于 Chrome 扩展程序（Manifest V3）构建的本地硬核精读工具。系统采用“斯巴达式”交互逻辑，通过强迫输出与底层逻辑拆解，辅助用户完成跨学科的知识内化。

## 核心理念

拒绝被动投喂，直击文本第一性原理。系统利用大语言模型（LLM）进行上下文动态扫描，结合“盲盒锁死”机制，强制读者在获取 AI 答案前完成独立的逻辑推演，最终将高价值认知沉淀为本地“知识晶体”。

## 功能特性

### 1. 本地数字中枢 (Local Hub)
- **多书隔离存储**：基于 IndexedDB (`AIReaderDB`) 实现，书籍资产本地化留存，无云端隐私泄露风险。
- **全局拖拽导入**：支持在数字大厅内通过全屏拖拽直接导入书籍，0 延迟渲染。
- **无感格式兼容**：原生支持 `.epub` 格式。针对 `.txt` 纯文本，系统利用 `JSZip` 在内存中实时封装为标准 EPUB 结构，实现排版降维打击与精准分页。

### 2. 四大硬核伴读技能 (AI Skills)
底层技能引擎通过 `epub.js` 获取精确的阅读游标（CFI）与 DOM 文本，结合大模型构建动态 Prompt：
- **前文复盘回顾**：提取隐性线索，串联底层认知框架。
- **提炼本章骨架**：直击第一性原理，剥离冗余修饰，输出结构化 Markdown。
- **解释选中段落**：规避跨页 DOM 死锁，精准提取高亮文本，进行跨语境映射。
- **沙盘推演测验**：抛出高阶反问并触发 UI 锁死。用户必须输入独立推演逻辑后，方可解锁后续阅读与对话。

### 3. 知识武器库 (Knowledge Arsenal)
- **碎片化采矿**：阅读过程中的高价值对话可一键提炼为“知识晶体”。
- **沉浸式回顾**：采用精装博客级 CSS 排版（大字号、宽行距、Markdown 实时解析），支持一键复制流转。

### 4. 极客级阅读体验
- **出版级排版干预**：强穿透 iframe 隔离，统一接管 EPUB 与 TXT 的字体、行距渲染。
- **零卡顿分页**：采用基于 Spine 索引的百分比进度算法，规避传统全书字符扫描的性能瓶颈。
- **深浅双色主题**：内置全局流式输出（SSE），支持打字机级动态渲染，双语一键切换。

## 技术架构

项目坚持“零外部框架”的 Vanilla JS 路线，确保扩展的极致轻量与安全。

- **扩展标准**：Chrome Manifest V3 (Service Worker 驱动)
- **持久化层**：IndexedDB (`db.js`) + `chrome.storage.local` (保存配置与多书阅读进度)
- **核心解析引擎**：`epub.min.js`
- **打包与渲染**：`jszip.min.js` (内存文件封装), `marked.min.js` (实时 HTML 转换)
- **通信协议**：Fetch API + Server-Sent Events (SSE) 处理 LLM 流式输出

## 物理拓扑

```text
AIReader/
├── manifest.json         # 扩展配置声明
├── background.js         # Service Worker，处理图标点击路由
├── library.html/css/js   # 数字大厅（主视图、书架、知识库、拖拽引擎）
├── reader.html/css/js    # 阅读器（主阅读区、AI 心智面板、主题控制）
├── options.html/js       # 配置中心（API Key、模型切换）
├── icons/                # 扩展图标库 (16, 32, 48, 128px)
└── skills/               # 核心逻辑模块
    ├── db.js             # 数据库引擎
    ├── api.js            # 流式大模型网关
    └── skills.js         # 认知技能 Prompt 策略组

```

## 安装指南

1. 下载或 Clone 本项目至本地目录。
2. 打开 Chrome 浏览器，进入扩展程序管理页：`chrome://extensions/`。
3. 开启右上角的 **开发者模式**。
4. 点击 **加载已解压的扩展程序**，选择本项目的根目录。
5. 扩展安装完成后，在浏览器工具栏右键点击 AIReader 图标，选择 **选项**。
6. 填入你的 DeepSeek API Key（或兼容 OpenAI 格式的其他模型接口），保存并测试连接。
7. 点击浏览器右上角的扩展图标，进入数字中枢，开始硬核阅读。

