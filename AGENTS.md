# AGENTS.md — 读见项目协作约定

> 本文件面向所有在此仓库工作的 AI 代理（Codex / Trae / Cursor 等）与人类协作者。
> **动手改代码之前，先读本文件。**

## 1. 项目是什么

读见（原 AIReader）是一个**本地优先**的 Chrome 扩展（Manifest V3）：导入 EPUB/TXT 后分页阅读，并提供四个 AI 陪读技能（前文复盘 / 提炼本章骨架 / 解释选中段落 / 盲盒式推演测验）。书籍与知识晶体只存在本地 IndexedDB；AI 通过用户自配的 DeepSeek（OpenAI 兼容协议）API 调用。

当前用户品牌为“读见”，品牌口号是“读进去，想明白”。`AIReader` 仅作为历史数据库名、旧协议和兼容标识保留，不得因为改名而迁移或清空已有本地数据。

长期北极星是“本地认知工作台”；近期正式定位是“面向研究型创作者和深度阅读者的、本地优先的‘阅读到观点’工作台”。当前第一验证用户是项目 Owner；研究型创作者 / 独立内容生产者是待验证的候选外部 ICP。不要把这一定义扩张为通用认知平台、NotebookLM 替代品或万能研究工具。

战略上的最终价值对象是“用户确认后的认知产物”，而不是自动摘要，也不立即把“观点”设为全系统的数据中心。人工校准、观点卡、Creator Brief 与轻量 Challenge 均为候选能力，当前未实现。

任何新功能在开工前必须回答：**它是否帮助用户从原始材料形成自己的、可核对的认知产物，并且有 Owner 或候选用户的真实失败案例支持？**不能回答时，默认不属于当前主线。

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
library.html/css/js  # 书架大厅：导入、书架、知识晶体
reader.html/css/js   # 阅读器：阅读区 + AI 面板 + 目录导航
options.html/js      # 配置中心：API Key / 模型 / Endpoint
skills/brand.js       # 品牌常量（用户品牌为“读见”，内部旧标识保持兼容）
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
- **JSON 模式兼容性**：`requestJSON()` 优先用 `response_format`，遇到 400/422 或空内容会自动回退普通模式重试；`extractJSONContent()` 会容错修复尾逗号并兼容顶层数组。Reduce 阶段开启 `fallbackRaw`：模型未按 JSON 输出时，直接把其 Markdown 输出作为框架内容（从第一个标题起截取）。模型还可能把 `framework_markdown` 嵌套成 JSON 字符串，展示/导出前必须经过 `normalizeFrameworkMarkdown()` 解包。
- **reasoning 模型**：思维链 token 计入 `max_tokens` 且经常把 content 挤空。提取管线在同一模型上最多试 2 档（Map 4000/8000，Reduce 8000），仍失败自动改用 `deepseek-chat` 重试（`buildMapAttempts` / `buildReduceAttempts`）。不要改回长 token 死磕策略。
- **提取速度与续传**：Map 默认并发 3（`CONCURRENCY`）；每块完成通过 `onChunkDone` 落盘到 `extractions` store（status: running + chunks 数组），下次提取自动 `resume` 跳过已完成块；成功后写 done 记录。并发上限、续传键名改动需同步 reader.js 与 db.js。
- **CFI 溯源锚点**：`buildBookChunks()` 按 DOM 段落（p/h1-h6/li/blockquote/pre）切块，每块只保存 `startText`（首段前 40 字）与章节 `href`，**不生成 CFI**（构建期 CFI 在真实渲染中易失效导致跳到首页）。Reduce 要求每条骨架要点标注来源分块【C编号】，`applyFrameworkAnchors()` 把标记替换为 `aireader-cfi:<chunkIndex>` 链接（无标记时按章节标题兜底）。`reader.js` 点击时：先 `rendition.display(href)` 加载章节，再按 startText 定位段落，用 `contents.cfiFromRange(range)` 生成 CFI 翻页；导出时链接剥离为纯文字。锚点随提取结果存 `extractions.anchors`。
- **提取弹窗防误关**：弹窗外点击不会关闭窗口（防误触中止提取）；关闭必须走 × /「取消提取」，提取中会弹确认框。
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

## 7. 封存问题（不要重新打开）

- **CFI 溯源跳转**（2026-08-02 封存）：单章大书/嵌套文档下翻页定位失效。已尝试构建期 CFI 与运行时文本定位两套方案，根因涉及 epub.js 0.3 对已显示章节的 `locationOf` 坐标滚动。在解封前：不要在提取管线上继续投入修复；README 与 UI 保持"实验性"标注。修复方向（择一）：强制重渲染章节后 display(cfi)、段落→页码缓存、`book.locations.generate()` 性能换精度、或降级为"跳章节+滚动段落"。

## 8. 变更纪律（正式项目流程）

- **先快照再大改**：涉及重构或新版本前，按 `docs/snapshots/README.md` 打 git tag + 写 SNAPSHOT.md。
- **更新日志**：每次用户可见变更同步更新 `CHANGELOG.md`（Keep a Changelog 格式），并在 Unreleased 下按 Added/Fixed/Changed 分组。
- **提交信息**：`type(scope): 摘要`，如 `fix(reader): 修复关闭书籍按钮 ReferenceError`；一次提交只做一件事，涉及多文件可分组提交。
- **文档同步**：功能/约定变化时同步更新 README 与 AGENTS.md，不留下"代码与文档打架"的欠账。
- **能力状态**：正式文档必须区分 `Current`、`Prototype / Experimental`、`Candidate / Planned`、`Deferred`、`Historical / Superseded`。当前工作区、`v1.1.0` 标签和 `origin/main` 不是同一事实层，不得混写。

## 9. 项目指挥与交接纪律

项目采用“长期指挥中枢 + 按工作包结束的执行会话 + 按 Gate 新开的审计会话”协作方式。项目状态以 Git、测试/手工验证记录和 `docs/HANDOFF_CURRENT.md` 为准，不以长对话历史为准。

- **Commander（总指挥）**：可以决定优先级、范围、验收与 Gate，不在执行任务中擅自扩大产品方向。每次面向 Owner 的回复必须附“指挥报告”：当前阶段、已完成、风险/阻塞、下一工作包、Gate 判断、任务类型与指定模型。
- **Executor（执行）**：只能在批准的工作包范围内改动；完成后必须更新 `docs/HANDOFF_CURRENT.md`，列出改动、验证、遗留风险和建议下一步。不得自行启动下一工作包或改变产品战略。
- **Auditor（审计）**：只检查指定基线或增量范围，输出 `GO / CONDITIONAL GO / NO-GO`、P0/P1/P2、证据和下一 Gate；默认不修改代码或文档。

每个工作包都必须明确标记以下字段：

```text
TYPE: EXECUTION | AUDIT
MODEL: <精确模型 ID> / <reasoning effort>
目标、允许修改、禁止修改、验收标准、必须验证、交接要求
```

模型分工默认如下；若任务事实显示不适合，Commander 必须在工作包中说明升级或降级原因：

- `EXECUTION`：核心功能、缺陷修复、跨文件实现默认 `gpt-5.6-terra / medium`；跨 5 个以上核心模块、核心存储/安全/提取管线高风险改动可升级为 `gpt-5.6-sol / medium` 或 `high`。
- `EXECUTION`：文档同步、搜索、机械替换、简单检查默认 `gpt-5.6-luna / medium`。
- `AUDIT`：里程碑或架构/产品偏航审计默认 `gpt-5.6-sol / high`；普通验收优先由 Commander 依据 diff 与验证记录完成，不滥用全盘审计。
- `Commander`：日常拆包与验收推荐 `gpt-5.6-terra / high`；改变战略、核心数据契约或安全边界时使用 `gpt-5.6-sol / high`。

审计分为增量审计与全盘审计。全盘审计只在正式发布候选、方法论/架构重大重构完成、公开放量前使用；其余重要节点只审自上次 Gate 以来的 diff、文档、验证记录和样本结果。
