# Changelog

本项目的所有重要变更都会记录在此文件中，格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- 新增**一键提取全书框架**（阶段 1 核心功能）：
  - 分层提取管线 `skills/extract.js`：spine/章节切分 → 逐块 Map 摘要（固定 JSON schema）→ 全局 Reduce 综合 → 全书框架 Markdown。
  - TXT 转换书自动按段落簇切块（每块 ≤8000 字），不再受"单 spine 整本书"限制。
  - 提取结果弹窗：实时进度（章节 x/N）、失败块容错不中断、取消机制（AbortController）。
  - 结果落库缓存（IndexedDB `extractions` store，db 版本 v3）：同一本书重复提取直接读缓存，避免重复扣费；支持"重新提取"强制更新。
  - 一键复制 Markdown / 下载 `.md` 文件（带 BOM，Windows 记事本不乱码）。
  - `api.js` 新增非流式 JSON 请求 `requestJSON()`（自动回退不支持 `response_format` 的端点）与 token 估算。

### Changed

- 删除书籍时级联清理该书的全书提取缓存。
- 版本升至 1.1.0。

### Fixed

- 修复 1.1.0 中误移除 reader.html 的 JSZip 依赖导致 EPUB 打开报错 "JSZip lib not loaded" 的问题（epub.js 在加载与运行时解包均依赖 JSZip）。
- 修复提取管线"模型未返回内容"：请求失败/空内容时自动回退普通模式重试；reasoning 类模型思维链耗尽 max_tokens 时给出明确提示。
- 修复模型输出 JSON 尾逗号导致解析失败的问题（自动容错修复）。
- 修复最后一步 Reduce 失败：模型未按 JSON 输出时自动降级，把其 Markdown 输出直接作为全书框架；JSON 解析兼容顶层数组。
- 提取管线 max_tokens 上调（Map 4000 / Reduce 8000），兼容思维链型模型。

## [1.0.1] - 2026-08-02

### Added

- 新增正式项目基建：`AGENTS.md`（协作约定）、`CHANGELOG.md`（本文件）、`LICENSE`（MIT）、`.gitignore`。
- 新增快照存档机制：`docs/snapshots/README.md` 约定 + `docs/snapshots/2026-08-02-v1.0.0/SNAPSHOT.md` 基线快照，并打 git tag `v1.0.0`。
- 新增 `skills/markdown.js` 安全渲染层：转义 AI 输出中的原始 HTML，外链强制 `rel="noopener noreferrer nofollow"`，并开启 `breaks` 换行。
- 阅读器新增**目录导航**（EPUB 章节侧栏，基于 epub.js `loaded.navigation`），支持点击章节跳转。
- 沙盘推演"盲盒锁死"升级：答案不足 30 字不解锁，导师不批阅。
- AI 请求期间禁用技能按钮与发送按钮，防止并发请求打乱对话上下文。
- 按技能配置输出上限（`max_tokens`）：本章骨架 4000 / 解释段落与复盘 2500 / 推演 2000。

### Fixed

- 修复关闭书籍按钮必崩 bug（`reader.js` 引用未定义的 `dropZone` / `fileInput`）。
- 修复自由提问不带书籍上下文的问题：现在自动注入当前页文本（截断 2000 字）。
- 修复 `chapter` / `quiz` 技能把整本 TXT 一次性发给模型的问题：上下文截断至 8000 字兜底。
- 修复 `chatHistory` 无界增长：会话只保留最近 12 轮（system 始终保留）。
- 修复阅读进度键与配置键冲突：进度统一存为 `progress:<书名>`。
- 修复进度百分比永远到不了 100% 的问题。
- 修复 TXT 导入只支持 UTF-8 的问题：GBK/GB18030 编码自动回退解码。
- 修复 TXT→EPUB 封装时书名未转义导致 OPF/NCX/HTML 损坏的问题。
- 修复书架卡片图标为损坏字符的问题（恢复 📚）。
- 统一模型名默认值（`deepseek-v4-flash`）于配置页、下拉列表与阅读器兜底逻辑。
- 修正配置页"本地加密存储"的不实宣传为"仅保存在本地，不上传服务器"。
- 清理 reader.js 头部过时的 LocalForage 注释。
- `manifest.json` 声明 `api.deepseek.com` 的 host 权限，减少官方 API 的跨域不确定性。

### Changed

- 旧审计报告归档至 `docs/archive/project_audit_report_2026-06-06_archived.md`。
- README 增加文档导航与开发协作指引；版本徽章更新为 1.0.1。

## [1.0.0] - 2026-06-06

首个可用版本。Chrome 扩展（MV3）本地 EPUB/TXT 阅读 + 四大 AI 陪读技能 + 知识晶体收藏。

### Added

- 书架大厅：EPUB/TXT 导入（TXT 内存封装为 EPUB）、全局拖拽、多书隔离存储（IndexedDB）。
- 阅读器：epub.js 分页渲染、深浅双主题、键盘翻页、基于 Spine 索引的进度显示、断点续传（`chrome.storage.local`）。
- AI 陪读面板：前文复盘回顾 / 提炼本章骨架 / 解释选中段落 / 沙盘推演测验，SSE 流式输出 + Markdown 实时渲染。
- 知识武器库：AI 对话一键收藏为知识晶体，支持复制与删除。
- 配置中心：API Key / 模型 / Endpoint 管理，连接测试。
