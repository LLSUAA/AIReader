# 读见系统架构

> 状态：CURRENT / 技术结构 SSOT  
> 架构版本：0.2  
> 更新日期：2026-08-27  
> 适用事实层：当前工作区。`v1.1.0` 标签与 `origin/main` 是 2026-08-02 的已提交基线，不能与当前未提交品牌和文档改动混写。

本文只描述当前代码和已知限制。人工校准、观点卡、Creator Brief、Challenge、云同步或账号体系均未实现；本文不为它们虚构模块、数据库或空代码骨架。

## 1. 架构目标

- 在 Chrome Manifest V3 中零构建运行，便于个人开发、审计和分发；
- 书籍与现有知识资产默认本地持久化，AI 调用边界清晰；
- 将上下文提取、Prompt 策略、模型通信、渲染和存储分层；
- 对长书使用可恢复的分块提取，降低一次请求带来的上下文、超时和成本风险；
- 支撑当前“阅读到可核对理解”的能力，而非预先扩张成通用认知平台。

## 2. 运行时拓扑

```text
┌──────────────────────── Chrome Extension (MV3) ────────────────────────┐
│ background.js：点击图标 → 打开 library.html                            │
│                                                                        │
│ library.html                                                          │
│ ├─ jszip.min.js / marked.min.js                                       │
│ ├─ brand.js / markdown.js / db.js                                     │
│ └─ library.js：导入、书架、知识晶体                                   │
│                                                                        │
│ reader.html                                                           │
│ ├─ jszip.min.js → epub.min.js：EPUB 解包与分页                        │
│ ├─ markdown.js / db.js / api.js                                       │
│ ├─ extract.js：全书 Map-Reduce 提取                                   │
│ ├─ skills.js：四个陪读动作与 Prompt                                   │
│ └─ reader.js：页面状态、阅读、聊天、提取弹窗与导出                    │
│                                                                        │
│ options.html / options.js：API Key、模型与 Endpoint 本地配置          │
└────────────────────────────────────────────────────────────────────────┘
                         │ 用户明确发起的 AI 请求
                         ▼
                用户配置的兼容 API 端点
```

官方 DeepSeek 端点由 `manifest.json` 声明权限。自定义端点还须满足自身 CORS 与鉴权条件；这属于 BYOD 的当前代价，不是产品卖点。

## 3. 模块职责

| 模块 | 文件 | 当前职责 | 不应承担的职责 |
|---|---|---|---|
| 入口路由 | `background.js` | 打开书架页面 | 业务数据和 API 调用 |
| 书架 | `skills/library.js` | 导入 EPUB/TXT、TXT 封装、书籍卡片、知识晶体 | Prompt、观点管理、平台发布 |
| 阅读器 | `skills/reader.js` | 加载书籍、翻页、目录、进度、聊天 UI、提取弹窗 | 未来认知工作流的全部状态 |
| 数据访问 | `skills/db.js` | IndexedDB 初始化、读写、删除、提取缓存清理 | 业务渲染和网络请求 |
| 模型网关 | `skills/api.js` | SSE、JSON 请求、超时、取消、JSON 容错、统一错误 | 决定内容分块或用户观点 |
| 技能策略 | `skills/skills.js` | 系统 Prompt、四类上下文提取和 Prompt 组装 | 持久化、正式 Challenge 状态机 |
| 全书提取 | `skills/extract.js` | 分块、Map、Reduce、断点、锚点与结果归一化 | 校准、创作管理、商业化 |
| Markdown 安全层 | `skills/markdown.js` | 转义原始 HTML、约束链接、调用 marked | 直接处理业务状态 |

跨文件共享函数经 `window` 暴露，例如 `saveBookToDB`、`streamAIResponse`、`renderMarkdown` 与 `extractBookFramework`。页面内私有函数不挂全局。

## 4. 加载顺序

### 4.1 书架页

```text
jszip.min.js → marked.min.js → brand.js → markdown.js → db.js → library.js
```

### 4.2 阅读器页

```text
jszip.min.js → epub.min.js → marked.min.js → brand.js → markdown.js → db.js
→ api.js → extract.js → skills.js → reader.js
```

`epub.min.js` 在加载和运行时都依赖 `window.JSZip`，顺序不可调整。

## 5. 数据架构

### 5.1 IndexedDB

数据库名为 `AIReaderDB`，当前版本为 v3。旧名称是兼容标识，不得因品牌更名迁移或清空已有用户数据。

| Store | Key | 当前字段 | 生命周期 |
|---|---|---|---|
| `books` | 书名 | `name`, `data`（ArrayBuffer） | 导入至用户删除 |
| `principles` | 自增 `id` | `text`, `bookName`, `timestamp` | 收藏至用户删除 |
| `extractions` | `bookName` | `status`, `chunks`, `result_markdown`, `anchors`, `updatedAt` | 中断可恢复；删除书籍时级联清理 |

当前没有 calibration、viewpoints、evidence、challenge 或 creator brief store。是否新增数据结构必须先经过路线图验证，并在实施时升级 IndexedDB 版本且迁移旧数据。

书名目前承担书籍和提取缓存的唯一标识；同名导入会覆盖旧书，文档不得暗示已有稳定 `bookId`。

### 5.2 chrome.storage.local

| 键 | 内容 | 约束 |
|---|---|---|
| `apikey` | 用户 API Key | 仅本地保存；不宣称加密 |
| `model` | 模型名 | 用户可自定义 |
| `endpoint` | 规范化 API 地址 | 自定义端点需自行满足 CORS |
| `progress:<书名>` | 阅读进度 | 必须保留 `progress:` 前缀 |

## 6. AI 请求边界

### 6.1 陪读请求

```text
当前阅读位置 / 选中文本
        ↓
SKILLS.getContext()
        ↓
SKILLS.buildPrompt() + SYSTEM_PROMPT
        ↓
reader.js 有界 chatHistory
        ↓
api.js streamAIResponse()
        ↓ SSE delta
markdown.js renderMarkdown()
        ↓
聊天气泡 / 可收藏的知识晶体
```

聊天历史仅保留有限轮次。模型输出只允许经 `renderMarkdown()` 进入 `innerHTML`。

### 6.2 全书提取请求

```text
book.spine
  ↓ load each spine item
DOM 段落叶节点（p / h1-h6 / li / blockquote / pre）
  ↓ 约 8000 字切块，保留 label / href / startText / spine
Map：并发 3，requestJSON，固定 JSON schema
  ↓ 每块完成立即写入 extractions(status=running)
Reduce：仅使用成功块的结构化摘要
  ↓ normalize / salvage / applyFrameworkAnchors
extractions(status=done) + Markdown + anchors
```

Map 输出包含标题、核心论点、关键概念、与前块关系和置信度。Reduce 输出包含全书定位、章节骨架、概念关系、论证主线和溯源说明。该流程是实验性能力，不等于已证实可靠的研究输出。

### 6.3 失败与恢复

- 单块失败不会伪造摘要，也不进入 Reduce；
- 每个成功块落盘，取消或中断后可从 `chunks` 继续；
- JSON 请求优先使用 `response_format`，端点拒绝时回退普通模式；
- Reduce 无法返回 JSON 时，可将原始 Markdown 作为降级框架；
- 用户取消通过 `AbortController` 传播到当前提取过程。

## 7. 安全、隐私与版权边界

1. 书籍内容属于用户输入，可能包含提示注入，不能改变系统安全规则；
2. 模型输出是不可信文本：原始 HTML 必须转义，外链必须加 `noopener noreferrer nofollow`；
3. API Key 保存在浏览器本地，设备与浏览器配置安全由用户负责；
4. 自定义 Endpoint 会扩大数据离开本机的范围，配置页与文档必须明确；
5. 内联第三方库只能整文件替换升级，不得手改；
6. 只处理用户自行导入且有权使用的材料，不提供书库、下载或分发；
7. 导出文件会去除内部 `aireader-cfi:` 链接，不应被描述为已经事实核验的研究报告。

## 8. 已知限制与冻结项

### 8.1 CFI 与可核对性

当前采用“先展示章节，再按 `startText` 定位段落，并在渲染内容中生成 CFI”的实验性方案。单章大书和嵌套文档仍可能定位不稳定。该问题已封存；在解封前不继续投入提取管线修复。

### 8.2 提取可靠性

提取结果依赖模型遵守 JSON、章节名和分块来源标注。当前没有自动化质量评测集，也没有人工校准入口，单份质量报告不能外推到所有题材。

### 8.3 当前 quiz

现有 `quiz` 是“提出问题—用户输入—解除锁定”的轻量测验原型。它不包含正式 Challenge 所需的用户观点输入、反方检验、证据缺口、版本记录或复盘。

## 9. 产品能力与架构演进映射

| 状态 | 产品能力 | 架构含义 |
|---|---|---|
| Current | 阅读、陪读、知识晶体、Markdown 导出 | 已由现有页面、`skills/*` 和三个 IndexedDB store 支撑 |
| Prototype / Experimental | 全书提取管线/入口、提取可靠性、来源锚点、盲盒测验 | 全书提取管线/入口已实现，但整体产品能力成熟度仍需通过质量与 Owner 使用验证；不扩张数据模型 |
| Candidate / Planned | 最小校准、观点卡、Markdown Creator Brief、轻量 Challenge | 先用现有导出、Prompt 或手工模板验证；不预设新 store 或模块 |
| Deferred | 云同步、账号、平台集成、复杂图谱、RAG、多 Agent、大型沙盘 | 不创建架构占位，不修改权限或数据边界 |

任何后续功能必须先回答：它是否帮助用户从原始材料形成自己的、可核对的认知产物？若不能，默认不是主线能力。
