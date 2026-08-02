# Changelog

本项目的所有重要变更都会记录在此文件中，格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

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
- 移除 reader.html 中无用的 jszip 加载；清理 reader.js 头部过时的 LocalForage 注释。
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
