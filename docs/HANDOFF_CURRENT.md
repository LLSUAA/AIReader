# 当前项目交接台

> 状态：WP-005_IMPLEMENTED_AWAITING_OWNER_VALIDATION
>
> 更新日期：2026-09-01
>
> 用途：本文件是当前工作包的最小交接面。每个执行任务完成后覆盖更新；历史理由、审计全文和长期决策分别保留在 Git、`docs/` 与决策记录中。

## 当前阶段

`R0｜可靠提取与 Owner 真实内容闭环`

## 当前工作包

```text
ID: WP-005
TYPE: EXECUTION
MODEL: gpt-5.6-sol / high
```

模型升级原因：连续阅读、位置恢复、目录联动、TXT 编码识别、TXT→EPUB 多章节转换与防覆盖同时位于“导入 → 阅读”核心主链，且必须兼容既有书籍与进度。

## 目标与完成状态

代码实现与静态/转换器验证已完成：阅读器默认连续滚动并保留分页；TXT 按明确编码顺序解码，生成可读段落、多章节 spine 与目录；同名 EPUB/TXT 不再静默覆盖。

Owner 验收仍未完成，当前 Gate 为 `CONDITIONAL GO`：工作区没有《全球金融格局》、真实 UTF-8 TXT 或 Owner 确认编码的真实 GBK/GB18030 TXT；两条 Chrome 控制路径均被环境阻断，因此没有五张真实 Chrome 截图，也不能宣称连续阅读 10 分钟、23/23 缓存、陪读调用或真实 GBK 导入通过。

未改 IndexedDB schema、既有 books/extractions 数据、`progress:<书名>` 键、Prompt、AI API、Map-Reduce、提取缓存、CFI 定位算法或第三方 min 文件；未迁移或重写旧 TXT 转换书；未提交、未打 tag、未改版本号。

## 设计与实现

### 连续阅读

- `reader.html` / `reader.css`：顶部增加“连续 / 分页”分段开关；连续模式去除固定纸页、外边距与阴影，正文滚动区占据稳定空间；分页模式保留原纸页、上一页/下一页与进度栏。
- `skills/reader.js`：默认使用 epub.js 0.3 的 `{ manager: "continuous", flow: "scrolled-doc" }`；分页使用 `flow: "paginated"`。模式切换不热改 manager，而是销毁并重建 rendition，再用当前 CFI 恢复位置。
- 阅读模式偏好保存到独立键 `dujian:reader:reading-mode:v1`；位置仍只写 `progress:<书名>`。连续滚动的 relocated 写入做 240ms 轻量节流，不改变数据格式。
- EPUB iframe 的连续主题将正文限制在 780px 舒适行宽，保留图片、SVG、视频、表格和预格式文本的可读边界；浅色/深色分别注册并随外壳切换。
- 目录项根据 relocated 的章节 href 高亮并在宽屏保持可见；空目录文案不再错误声称 TXT 不支持目录。
- 陪读工作区可收起为 54px 窄边栏，折叠偏好保存到 `dujian:reader:ai-pane-collapsed:v1`，展开/收起后保留当前 CFI 重算阅读区，不覆盖正文。
- 来源跳转代码与算法未改，仍保持实验性语义；连续模式精确定位继续受既有 CFI 封存问题约束。

### TXT 与导入

- `skills/library.js` 编码顺序固定为：UTF-8 BOM → UTF-16 LE/BE BOM → 严格 UTF-8 → GB18030（UI 明示“兼容 GBK / GB2312”）。替换字符、异常控制字符、空正文或 BOM 对应解码失败会中止导入，不再宽松 UTF-8 兜底。
- 规范化 BOM、CRLF/CR、NBSP、零宽字符、行尾空白与过量空行。空行和段首缩进参与分段，同段物理换行合并；列表、诗歌式短行和缩进代码分别保留结构。
- 识别“第 X 章 / 节 / 卷 / 篇 / 部 / 集 / 回”、序/序言/前言/引言/导言/楔子/后记/跋/附录，以及有空行边界的合理数字标题。检出标题时生成多份 XHTML、spine 与 NCX；未检出时只生成单一“正文”。
- EPUB 导入前检查 ZIP 与 `META-INF/container.xml`。导入状态明确显示 `EPUB`，或 `TXT · 识别编码 · 章节数/未检测到章节`。
- 新 TXT 保存为 `书名 [TXT].epub`，重复导入递增为 `[TXT 2]`；重复 EPUB 使用 `[EPUB 2]`。旧 `书名.epub` 与已有旧 TXT 转换书不迁移、不重写，新排版必须重新导入。

完整设计基线见 `docs/ux/WP-005_READING_IMPORT.md`。

## 修改文件

- `reader.html`
- `reader.css`
- `skills/reader.js`
- `library.html`
- `library.css`
- `skills/library.js`
- `docs/ux/WP-005_READING_IMPORT.md`
- `CHANGELOG.md`
- `docs/HANDOFF_CURRENT.md`

## 已执行验证

### 自动与代码级验证

- `node --check skills/reader.js`：通过。
- `node --check skills/library.js`：通过。
- `git diff --check`：通过；只有工作区既有 LF/CRLF 转换警告，无空白错误。
- 内存转换器测试：通过严格 UTF-8、UTF-16 LE BOM、GB18030 回退；测试 GBK 字节 `B5 DA D2 BB D5 C2 / D6 D0 CE C4` 被识别为 `GB18030（兼容 GBK / GB2312）` 并解码为“第一章 / 中文”。这只是合成字节检查，不是 Owner 真实 GBK 文件验收。
- 章节/排版结构测试：UTF-8 内存样本识别“前言 / 第 一 章 起点 / 第二章 深入”共 3 章；自动折行合并；生成 EPUB 包含 3 份 XHTML、3 个 spine item 和对应 NCX。无标题样本降级为单一“正文”；异常字节样本被拒绝。
- 防覆盖命名测试：已有 `同名.epub` 与 `同名 [TXT].epub` 时，新 TXT 生成 `同名 [TXT 2].epub`。

### 未完成的真实验收

| 测试文件 | 格式 / 编码 | 状态 | 未完成项 |
| --- | --- | --- | --- |
| 《全球金融格局》 | EPUB | 未提供 / 未执行 | 连续阅读 10 分钟、刷新位置、目录、陪读折叠、分页回退、来源跳转、23/23 缓存 |
| Owner 真实 UTF-8 TXT | TXT / UTF-8 | 未提供 / 未执行 | 真实段落、目录跳章、连续/分页、选段解释 |
| Owner 真实 GBK 文件 | TXT / GBK 或 GB18030 | 未提供 / 未执行 | 无乱码/无 `�`、编码提示、滚动、分页、陪读 |
| 同名 EPUB/TXT | EPUB + TXT | 未提供 / 未执行 | IndexedDB 实际共存与原 EPUB 内容不变 |

Chrome 验证路径：应用内 Chrome 控制返回 `Browser is not available: chrome`；Windows 控制随后找到了唯一 Chrome 窗口，但因无法可信判断当前 URL 而触发安全中止。未绕过限制、未操作 Owner 数据，因此五张要求截图均未生成。

## Owner 手测与截图

1. 在 `chrome://extensions` 重新加载扩展，打开《全球金融格局》。连续阅读至少 10 分钟，确认无固定大空白；刷新并重开，确认位置接近原处；截取“EPUB 连续阅读”。
2. 展开/收起陪读，确认不遮正文并调用一次陪读；截取“陪读展开”。切到分页，验证按钮、左右键、进度和刷新恢复；截取“分页回退”。
3. 在提取入口读取既有 23/23 缓存并点一条来源跳转，确认至少回到对应章节且 UI 仍标“实验性”。
4. 导入真实 UTF-8 TXT，记录文件名与确认编码；核对导入提示、章节数、自然段合并、目录跳章、连续/分页和一次选段解释；截取“UTF-8 TXT 与目录”。
5. 导入 Owner 确认编码的真实 GBK/GB18030 TXT，核对无 `�`/乱码/标题乱码、提示显示 `GB18030（兼容 GBK / GB2312）`、滚动、分页和一次陪读；截取“GBK/GB18030 TXT 与编码提示”。
6. 导入同名 EPUB 与 TXT，确认两张书卡及两本内容都可独立打开；检查旧书、旧进度、知识晶体、API 配置与提取缓存均未变化。

## 风险、Gate 与下一步

- `CONDITIONAL GO`：代码与转换器级验证通过，可进入 Owner 真实 Chrome 验收；在五张截图与真实测试文件记录齐全前不得判定 WP-005 完成发布验收。
- epub.js 连续 manager 在复杂多章节 EPUB 上的预加载、跨章节滚动与 CFI 恢复仍须用《全球金融格局》验证。若出现跨章不稳定、刷新明显错位或来源跳转无法回章，应把分页偏好设为默认回退并将 Gate 降为 `NO-GO`，不要扩大修复到封存的 CFI 算法。
- GB18030 是 GBK/GB2312 的兼容超集，无法仅凭成功解码精确区分三者；UI 如实显示兼容解码器，而不伪称识别到具体 GBK。真实文件若仍乱码，必须记录原始字节与现象并判 `NO-GO`。
- 下一步只允许 Owner 完成本工作包手测、截图和 Gate；不启动人工校准、观点卡、Challenge 或其他功能。
