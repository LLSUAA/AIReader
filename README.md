# 读见：从阅读到观点的本地工作台

![Version](https://img.shields.io/badge/version-1.1.0-blue.svg)
![Platform](https://img.shields.io/badge/platform-Chrome_Extension-green.svg)
![Tech Stack](https://img.shields.io/badge/tech-Vanilla_JS-orange.svg)

读见（原 AIReader）是一个本地优先的 Chrome Manifest V3 扩展。它帮助研究型创作者和深度阅读者，把自己导入的 EPUB/TXT 从阅读材料转为可核对的理解，并在人工修正后继续形成可用于创作的认知产物。

长期北极星是“本地认知工作台”；近期定位是：

> 面向研究型创作者和深度阅读者的、本地优先的“阅读到观点”工作台。

读见不是通用认知平台、NotebookLM 替代品或替用户思考的 AI 阅读器。AI 负责拆解、提问、暴露结构与整理表达；最终理解、判断和公开表达由用户确认。

> 品牌口号：读进去，想明白。

## 当前阶段

当前工作区处于“可自用原型 → 验证可靠提取与 Owner 内容闭环”的阶段。`v1.1.0` 标签和 `origin/main` 是 2026-08-02 的已提交基线；本 README 说明的是当前工作区的产品战略，不能把它误读为已发布功能清单。

| 状态 | 能力 |
|---|---|
| Current | EPUB/TXT 本地导入、书架、分页阅读、目录、进度、主题、四个 AI 陪读动作、知识晶体、Markdown 复制/下载 |
| Prototype / Experimental | 全书 Map-Reduce 框架提取、断点续传、来源锚点跳转、盲盒式推演测验 |
| Candidate / Planned | 最小人工校准、轻量观点卡、Markdown Creator Brief、轻量观点压力测试 |
| Deferred | 云账号、云同步、移动端、社交、自动发布、复杂知识图谱、RAG/向量库、多 Agent、大型沙盘、SaaS、支付与会员 |

全书提取已能运行，但尚未完成跨题材质量基线；CFI 精确跳转在部分 EPUB 中不稳定，均不得宣传为稳定承诺。

## 工作流

```text
SOURCE（当前为 EPUB/TXT）
→ EXTRACT（结构提取）
→ CALIBRATE（人工修正，候选）
→ THINK（形成用户确认的认知产物，候选）
→ CHALLENGE（观点压力测试，候选）
→ CREATE（Creator Brief / Markdown 创作素材，候选）
→ CRYSTALLIZE（本地长期沉淀）
```

这是一条产品方向链，不是一组已经完成的模块。当前真正需要验证的是：可靠提取能否帮助 Owner 完成真实的阅读、修正和内容产出闭环。

## 不可破坏的边界

- 本地优先、BYOD：书籍、缓存和知识晶体默认保存在本机；用户明确发起 AI 请求时，相关上下文才会发送给其配置的 API 端点。
- 版权：只处理用户自行导入且有权使用的文件；不提供书库、下载或分发。
- AI 输出不可信：模型输出必须可核对，且 Markdown 仅能经安全渲染层进入页面。
- 弱耦合内容桥接：读见可以提供研究与创作素材，但不绑定账号、平台、发布、粉丝或引流。
- 配置 API 是当前 BYOD 架构的代价，不是产品价值；未来可做低成本易用性改进，但不因此引入云代理、账号或 SaaS。

## 文档导航

| 文档 | 状态与职责 |
|---|---|
| [WHITEPAPER.md](WHITEPAPER.md) | CURRENT：产品战略 SSOT |
| [ARCHITECTURE.md](ARCHITECTURE.md) | CURRENT：当前工作区技术结构与能力边界 SSOT |
| [docs/ROADMAP.md](docs/ROADMAP.md) | CURRENT：验证优先的开发路线 |
| [docs/DECISIONS.md](docs/DECISIONS.md) | CURRENT：不可静默推翻的产品与技术决策 |
| [AGENTS.md](AGENTS.md) | CURRENT：协作者与 AI 代理执行约束 |
| [docs/README.md](docs/README.md) | CURRENT：完整文档阅读顺序与状态 |
| [CHANGELOG.md](CHANGELOG.md) | CURRENT：变更时间线 |
| [项目规划报告_2026-08-02.md](项目规划报告_2026-08-02.md) | SUPERSEDED：历史规划参考 |
| [项目报告_2026-08-02.md](项目报告_2026-08-02.md) | HISTORICAL：历史技术审计 |

## 安装

1. 下载或 Clone 本项目到本地目录。
2. 打开 Chrome 的 `chrome://extensions/`，启用开发者模式。
3. 点击“加载已解压的扩展程序”，选择项目根目录。
4. 在“读见”配置页填写兼容 OpenAI Chat Completions 的 API Key、模型与端点。
5. 导入自己拥有或有权使用的 EPUB/TXT，开始阅读与核对。

## 协作

改动前请先阅读 [AGENTS.md](AGENTS.md)。本项目保持零构建 Vanilla JS；涉及重构或发版前按 [快照规范](docs/snapshots/README.md) 留存快照。
