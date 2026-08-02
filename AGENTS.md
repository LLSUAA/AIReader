# AGENTS.md — AIReader 项目协作约定

> 本文件面向所有在此仓库工作的 AI 代理（Codex / Trae / Cursor 等）与人类协作者。
> **动手改代码之前，先读本文件。**

## 1. 项目是什么

AIReader 是一个**本地优先**的 Chrome 扩展（Manifest V3）：导入 EPUB/TXT 后分页阅读，并提供四个 AI 陪读技能（前文复盘 / 提炼本章骨架 / 解释选中段落 / 沙盘推演测验）。书籍与知识晶体只存在本地 IndexedDB；AI 通过用户自配的 DeepSeek（OpenAI 兼容协议）API 调用。

项目定位（2026-08 规划确认）：不做"阅读器"，做"**知识提取器**"——帮助深度阅读者把一本书的核心框架在 30 分钟内结构化提取出来。

## 2. 不可破坏的底线（最高优先级）

1. **BYOD 隐私边界**：书籍、笔记、对话**绝不**上传任何非用户指定的服务器。新增功能不得引入云存储、遥测、第三方统计。
2. **版权红线**：只处理用户自行导入的文件。不内置书库、不提供下载、不做版权内容分发。
3. **第三方库不动**：`epub.min.js` / `jszip.min.js` / `marked.min.js` / `localforage.min.js`（若存在）是内联第三方产物，**禁止手改**；升级必须整文件替换并记录版本。
4. **AI 输出不可信**：所有经过 `marked` 渲染的内容必须走 `skills/markdown.js` 的安全渲染（转义原始 HTML、外链加 `rel="noopener noreferrer nofollow"`）。禁止直接 `innerHTML = marked.parse(...)`。
5. **本地存储键防冲突**：`chrome.storage.local` 中阅读进度必须使用 `progress:<书名>` 前缀，禁止裸用书名（防止与 `apikey/model/endpoint` 等配置键冲突）。

## 3. 架构速览

```text
manifest.json        # MV3 声明；入口：library.html / reader.html / options.html
background.js        # Service Worker：点击图标 → 打开 library.html
library.html/css/js  # 书架大厅：导入、书架、知识武器库
reader.html/css/js   # 阅读器：阅读区 + AI 面板 + 目录导航
options.html/js      # 配置中心：API Key / 模型 / Endpoint
skills/db.js         # IndexedDB 封装（books / principles）
skills/api.js        # SSE 流式网关（含渲染节流、max_tokens 按技能配置）
skills/extract.js    # 全书框架分层提取管线（Map-Reduce + 取消机制）
skills/markdown.js   # 安全 Markdown 渲染（唯一允许的 marked 出口）
skills/skills.js     # 4 个 AI Skill：getContext + buildPrompt（prompt 是产品灵魂）
skills/reader.js     # 阅读引擎 + AI 交互调度
skills/library.js    # 导入 / TXT→EPUB / 书架渲染
docs/                # 报告、快照、归档
```

数据流：`reader.html?book=<书名>` → IndexedDB 取书 → epub.js 渲染 → `getContext()` 提取上下文 → `buildPrompt()` 组装 → `streamAIResponse()` 流式返回 → 安全渲染上屏 → 可收藏为知识晶体。

## 4. 代码约定

- **零构建、零框架**：Vanilla JS IIFE 风格（`(function (global) {...})(window)`），无 package.json、无打包器。新增功能保持无构建即可运行。
- **语言**：代码注释与用户可见文案用中文；标识符用英文。
- **API 命名**：跨文件共享函数挂 `window`（如 `saveBookToDB`、`renderMarkdown`、`streamAIResponse`）；文件内私有函数不挂全局。
- **错误处理**：异步链路必须 try/catch；用户可见错误用聊天气泡/alert 呈现，控制台用 `console.error`。
- **prompt 修改**：`skills/skills.js` 的 `SYSTEM_PROMPT` 与四个 `buildPrompt` 是产品核心资产。修改时保持四条灵魂规则（拒绝被动投喂 / 审美语境同频 / 跨语境映射 / 苏格拉底诘问）与输出纪律（结构化分块、防幻觉、不越界预测）。
- **CSS 变量**：深浅主题通过 `[data-theme]` 变量切换；新增样式优先使用 `var(--xxx)`，禁止写死颜色（除非该处本来就不随主题变化）。

## 5. 已知技术约束（改代码前必看）

- **epub.js 0.3**：目录用 `book.loaded.navigation`（Promise → `{ toc: [...] }`）；翻页/定位用 `rendition.currentLocation().start.index` 与 CFI。TOC 条目结构 `{ href, label, subitems }`。
- **epub.js 依赖 JSZip**：`epub.min.js` 在加载时即读取 `window.JSZip`，运行时解包 EPUB 也需要它。`reader.html` 与 `library.html` 都必须在 `epub.min.js` 之前加载 `jszip.min.js`，**不要误删**（2026-08-02 曾因此踩坑）。
- **全书提取管线**：`skills/extract.js` 是"一键提取全书框架"的唯一入口。Map 阶段输出固定 JSON schema（title/core_points/concepts/relation_to_prev/confidence），Reduce 阶段输出 `{ book_summary, framework_markdown }`。结果缓存在 IndexedDB `extractions` store（keyPath: bookName），改 schema 时必须同步升级缓存结构（db 版本 v3）。
- **MV3 CSP**：扩展页禁止内联 `<script>`（event handler 属性也不可用）；跨域 fetch 需要 `host_permissions`（目前声明了 `api.deepseek.com`），自定义 Endpoint 需对方允许 CORS。
- **IndexedDB 版本升级**：改 `db.js` 的 store 结构时递增 `indexedDB.open(DB_NAME, N)` 的版本号，并在 `onupgradeneeded` 中迁移；用户已有数据不可丢。
- **TXT 单章节陷阱**：`library.js` 把 TXT 封装为单个 spine item，导致"提炼本章骨架"会拿到整本书。当前 `skills.js` 有 8000 字截断兜底；未来"全书提取"必须按块切分（见项目规划报告）。

## 6. 验证清单（每次改动后）

1. `node --check` 所有改动的 JS 文件（本项目是浏览器代码，node 只做语法检查）。
2. Chrome `chrome://extensions` → 开发者模式 → 重新加载扩展。
3. 手动冒烟：导入一本 EPUB + 一本 GBK 编码 TXT → 打开阅读 → 翻页/断点续传 → 目录跳转 → 四个 AI 技能各点一次 → 自由提问（确认 AI 能看到当前页）→ 收藏/删除知识晶体 → 删除书籍 → 关闭书籍按钮。
4. 提取管线冒烟：打开一本多章节 EPUB → 点"一键提取全书框架" → 观察进度与结果 → 复制/下载 Markdown → 关闭重开再次提取（应命中缓存）→ 点"重新提取"（应强制重跑）→ 提取中取消 → 删除书籍（缓存应级联清除）。
4. 修改存储逻辑后：确认旧书与新书进度互不干扰，书名为 `apikey.epub` 时配置不被破坏。
5. 修改 AI 链路后：确认聊天气泡无原始 HTML 注入（可在 API 返回中故意含 `<img onerror>` 验证）。

## 7. 变更纪律（正式项目流程）

- **先快照再大改**：涉及重构或新版本前，按 `docs/snapshots/README.md` 打 git tag + 写 SNAPSHOT.md。
- **更新日志**：每次用户可见变更同步更新 `CHANGELOG.md`（Keep a Changelog 格式），并在 Unreleased 下按 Added/Fixed/Changed 分组。
- **提交信息**：`type(scope): 摘要`，如 `fix(reader): 修复关闭书籍按钮 ReferenceError`；一次提交只做一件事，涉及多文件可分组提交。
- **文档同步**：功能/约定变化时同步更新 README 与 AGENTS.md，不留下"代码与文档打架"的欠账。
