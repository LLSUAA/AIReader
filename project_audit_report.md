# AIReader 架构与排版审查报告

> 审计日期：2026-06-06  
> 审计范围：全项目源代码静态扫描  
> 审计专家：AIReader 高级代码审计专家

---

## 1. 项目架构与物理拓扑

### 1.1 文件清单与核心职责

| 文件 | 路径 | 核心职责 |
|------|------|----------|
| `manifest.json` | `e:\AIReader\manifest.json` | Chrome Extension Manifest V3 入口声明 |
| `background.js` | `e:\AIReader\background.js` | Service Worker：监听图标点击，打开 library.html |
| `library.html` | `e:\AIReader\library.html` | 书架大厅（数字中枢）：导入书籍、展示书架 Grid、知识武器库 |
| `reader.html` | `e:\AIReader\reader.html` | 阅读器主界面：70% 阅读区 + 30% AI 陪读面板 |
| `options.html` | `e:\AIReader\options.html` | 配置中心：API Key、模型、Endpoint 管理 |
| `library.css` | `e:\AIReader\library.css` | 书架大厅与知识武器库的全部样式 |
| `reader.css` | `e:\AIReader\reader.css` | 阅读器 + AI 面板的完整样式（含浅色/深色主题变量） |
| `skills/db.js` | `e:\AIReader\skills\db.js` | IndexedDB 持久化引擎：书籍存取、知识晶体存取 |
| `skills/api.js` | `e:\AIReader\skills\api.js` | 流式 AI 通信层：SSE 解析、marked 渲染 |
| `skills/skills.js` | `e:\AIReader\skills\skills.js` | 4 大 AI Skill 定义：上下文提取 + Prompt 构建 |
| `skills/reader.js` | `e:\AIReader\skills\reader.js` | 核心阅读引擎：epub.js 渲染、翻页、主题、AI 交互 |
| `skills/library.js` | `e:\AIReader\skills\library.js` | 书架逻辑：TXT→EPUB 转换引擎、导入/渲染/删除 |
| `options.js` | `e:\AIReader\options.js` | 配置页逻辑：保存/加载/测试连接 |
| `epub.min.js` | `e:\AIReader\epub.min.js` | epub.js 库（第三方，epub 渲染核心） |
| `jszip.min.js` | `e:\AIReader\jszip.min.js` | JSZip 库（第三方，TXT→EPUB 内存打包） |
| `marked.min.js` | `e:\AIReader\marked.min.js` | marked 库（第三方，Markdown→HTML 渲染） |

### 1.2 Manifest V3 权限与入口配置分析

**文件位置**: [manifest.json](file:///e:/AIReader/manifest.json)

```json
{
  "manifest_version": 3,
  "name": "AIReader - 深度认知伴侣",
  "version": "1.0.0",
  "permissions": ["storage", "activeTab"],
  "action": {
    "default_title": "打开 AIReader 阅读引擎"
  },
  "background": {
    "service_worker": "background.js"
  },
  "options_page": "options.html",
  "icons": {}
}
```

**逐项分析**:

| 配置项 | 值 | 分析 |
|--------|-----|------|
| `manifest_version` | `3` | 使用最新 Manifest V3，Service Worker 替代了持久化 Background Page |
| `permissions` | `["storage", "activeTab"]` | `storage` 用于 `chrome.storage.local` 存储 API Key 与阅读进度 CFI；`activeTab` 为当前激活标签页权限（当前代码中未实际使用，属于预留权限） |
| `action` | 无 `default_popup` | 点击图标不弹出 popup，而是通过 `background.js` 的 `chrome.action.onClicked` 事件打开全屏标签页 `library.html`。这是一个**正确的设计决策**——阅读器不适合弹窗模式 |
| `background.service_worker` | `background.js` | 极简实现（仅 5 行），仅负责 `chrome.action.onClicked` → `chrome.tabs.create` 的单一路由 |
| `options_page` | `options.html` | 配置页通过右键图标 → "选项" 进入，也可从 library.html 的导航栏直接打开 |
| `icons` | `{}` | **空对象**，没有提供任何尺寸的图标。建议补充 16/48/128 尺寸图标 |

**入口路由拓扑**:

```
用户点击扩展图标
  └─ background.js (chrome.action.onClicked)
       └─ chrome.tabs.create({ url: 'library.html' })
            ├─ [导航栏] → reader.html?book=xxx（阅读器）
            ├─ [导航栏] → options.html（配置中心）
            └─ [导航栏] → 知识武器库（library.html 内切换 view）
```

---

## 2. 数据流与持久化引擎 (db.js & api.js)

### 2.1 IndexedDB (AIReaderDB) 数据结构

**文件位置**: [skills/db.js](file:///e:/AIReader/skills/db.js)

数据库版本 `2`，包含两个 Object Store：

#### Store 1: `books`（无 keyPath，使用显式 Key）

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | `string` | 主键（显式 Key），如 `"三体.epub"` |
| `data` | `ArrayBuffer` | 书籍二进制数据（EPUB 格式），TXT 导入时已通过 `txtToEpubArrayBuffer` 转换为 EPUB |

**关键设计决策**:
- 使用书名作为 Key（`put(bookData, bookData.name)`），确保同一书名覆盖更新，天然支持多书共存
- `getAllBooksMeta()` 返回时仅映射 `{ name: b.name }`，**不返回 `data` 字段**，避免书架列表渲染时内存爆炸
- 旧接口 `loadBookFromDB()` / `clearBookFromDB()` 保留向后兼容，内部调用新 API

#### Store 2: `principles`（keyPath: `"id"`, autoIncrement）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `number` | 自增主键 |
| `text` | `string` | 知识晶体正文（Markdown 格式） |
| `timestamp` | `number` | 收藏时间戳（`Date.now()`） |
| `bookName` | `string` | 来源书名 |

#### 全局暴露的 API 接口

| 函数 | 签名 | 用途 |
|------|------|------|
| `saveBookToDB(bookData)` | `async` | 保存/更新书籍 |
| `getBookFromDB(bookName)` | `async` | 按书名获取单本书（含二进制 data） |
| `getAllBooksMeta()` | `async` | 获取所有书名列表（不含 data） |
| `deleteBookFromDB(bookName)` | `async` | 删除单本书 |
| `getAllPrinciples()` | `async` | 获取全部知识晶体 |
| `deletePrinciple(id)` | `async` | 删除指定知识晶体 |
| `savePrincipleToDB(principleData)` | `async` | 新增知识晶体 |
| `loadBookFromDB()` | `async` | 兼容旧接口：返回第一本书 |
| `clearBookFromDB()` | `async` | 兼容旧接口：清空所有书 |

### 2.2 TXT/EPUB 文件全生命周期

**文件位置**: [skills/library.js](file:///e:/AIReader/skills/library.js) 中的 `handleImportFile()` 与 `txtToEpubArrayBuffer()`

```
┌─────────────────────────────────────────────────────────────────┐
│ 阶段 1: 导入触发                                                 │
│   用户点击「导入新书」或全局拖拽 → change/drop 事件               │
│   → handleImportFile(file)                                      │
│   → 校验后缀名 (.epub / .txt)                                    │
│   → FileReader.readAsArrayBuffer(file)                          │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 阶段 2: 格式统一（TXT → EPUB 内存转换）                          │
│   IF .epub: arrayBuffer = event.target.result (直接透传)        │
│   IF .txt:                                                      │
│     a. TextDecoder("utf-8").decode(arrayBuffer) → 纯文本         │
│     b. txtToEpubArrayBuffer(txtContent, title):                 │
│        - 安全转义 HTML 特殊字符 (< >)                            │
│        - 按行分割，每行包 <p> 标签，过滤纯空行                    │
│        - 注入内联 <style> 排版（font-size: 1.15em,              │
│          line-height: 1.7, text-align: justify）                │
│        - JSZip 打包为标准 EPUB 结构（mimetype +                 │
│          META-INF/container.xml + OEBPS/content.opf +           │
│          OEBPS/toc.ncx + OEBPS/chapter.html）                   │
│        - zip.generateAsync({ type: "arraybuffer" })             │
│     c. finalName = title + ".epub"                              │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 阶段 3: 持久化存储                                               │
│   await saveBookToDB({ name: finalName, data: arrayBuffer })    │
│   → IndexedDB: AIReaderDB.books.put(bookData, name)             │
│   → renderBooks() 刷新书架 UI                                    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 阶段 4: 读取渲染                                                 │
│   用户点击书架卡片 → reader.html?book=xxx                        │
│   → reader.js: getBookFromDB(targetBookName)                    │
│   → book = ePub(bookData.data)                                 │
│   → rendition = book.renderTo("viewer", { flow: "paginated" })  │
│   → rendition.display(startCfi)                                 │
│   → 异步生成页码: book.locations.generate(2000)                  │
└─────────────────────────────────────────────────────────────────┘
```

**数据流特点**:
- 所有数据**只存在于本地 IndexedDB 和 chrome.storage.local**，无任何网络上传
- TXT 在导入时即转换为 EPUB 格式存储，阅读器无需区分原始格式
- 阅读进度（CFI）按书名隔离存储在 `chrome.storage.local`，支持多书断点续传

---

## 3. AI Skills 引擎结构 (skills.js & reader.js)

### 3.1 四大 Skill 定义与上下文提取逻辑

**文件位置**: [skills/skills.js](file:///e:/AIReader/skills/skills.js)

#### Skill 1: `history` — 前文复盘回顾

```javascript
getContext: async (rendition, book) => {
  const location = rendition.currentLocation();
  // 获取当前 spine 位置，向前回溯最多 2 个 spine item
  const startIndex = Math.max(0, location.start.index - 2);
  for (let i = startIndex; i < location.start.index; i++) {
    const spineItem = book.spine.get(i);
    await spineItem.load(book.load.bind(book));
    historyText += spineItem.document.body.textContent;
  }
  // 截断到 15000 字符
  return { text: historyText.substring(historyText.length - 15000) };
}
```

**提取策略**: 利用 `location.start.index` 定位当前 spine 位置，回溯加载前 2 个 spine item 的文档内容，拼接后取尾部 15000 字符。**注意**: 这里有个潜在问题——`location.start.index` 是 epub.js 内部的 location 对象属性，并非标准 API，在不同版本中可能不稳定。

#### Skill 2: `chapter` — 提炼本章骨架

```javascript
getContext: async (rendition) => {
  const contents = rendition.getContents();
  const text = contents[0].document.body.textContent || contents[0].document.body.innerText || "";
  return { text };
}
```

**提取策略**: 直接读取当前 iframe 内渲染的文档 body 全文。这是最简洁可靠的提取方式，缺点是如果当前章节特别长（如单一 HTML 文件包含整本书），会传递大量文本。

#### Skill 3: `quiz` — 沙盘推演测验

```javascript
getContext: async (rendition) => global.SKILLS.chapter.getContext(rendition)
```

**提取策略**: 完全复用 `chapter` 的上下文提取逻辑。

#### Skill 4: `explain` — 解释选中段落（绕过 getRange 死锁的关键）

```javascript
getContext: async (rendition) => {
  try {
    const iframeWindow = rendition.getContents()[0].window;
    const selection = iframeWindow.getSelection().toString().trim();
    if (selection) return { text: selection };  // 优先使用用户高亮选中

    // 降级方案：安全截取当前页文本，避免 getRange 死锁
    const text = rendition.getContents()[0].document.body.innerText || "";
    return { text: text.substring(0, 1000) };
  } catch (e) {
    return { error: "提取失败..." };
  }
}
```

**死锁绕过分析**:
- 传统做法是调用 `iframeWindow.getSelection().getRangeAt(0)` 来获取精确选区，但在 epub.js 的 iframe 隔离环境中，`getRangeAt(0)` 在跨 iframe 边界时可能导致 Range 对象失效或抛出 `IndexSizeError`
- 当前实现**只调用 `getSelection().toString()`**，直接获取纯文本字符串，完全不触碰 Range 对象，彻底规避了 `getRangeAt` 死锁
- 降级方案（无选中时）使用 `innerText.substring(0, 1000)` 安全截取，避免全文传递

### 3.2 流式输出（SSE）接收与 UI 状态锁死机制

**文件位置**: [skills/api.js](file:///e:/AIReader/skills/api.js) 与 [skills/reader.js](file:///e:/AIReader/skills/reader.js)

#### SSE 流式接收流程

```javascript
// api.js: streamAIResponse
const response = await fetch(endpoint, {
  body: JSON.stringify({ stream: true })  // 关键：启用流式
});
const reader = response.body.getReader();
const decoder = new TextDecoder("utf-8");
let buffer = "";

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split('\n');
  buffer = lines.pop();  // 保留不完整的最后一行

  for (const line of lines) {
    if (line.startsWith("data: ") && line !== "data: [DONE]") {
      const delta = JSON.parse(line.slice(6)).choices[0].delta.content;
      if (delta) {
        fullContent += delta;
        bubbleElement.innerHTML = marked.parse(fullContent);  // 实时渲染
        chatContainer.scrollTop = chatContainer.scrollHeight;  // 自动滚动
      }
    }
  }
}
```

**技术要点**:
- 使用 `ReadableStream` API 逐块读取，支持 SSE 标准格式
- buffer 机制处理跨 chunk 的不完整行
- 每次收到 delta 后立即用 `marked.parse()` 渲染整个 `fullContent`，实现打字机效果
- 自动滚动到底部

#### Hardcore Loop 锁死机制

**文件位置**: [skills/reader.js](file:///e:/AIReader/skills/reader.js) 中的 `setQuizLock()` 函数

```javascript
function setQuizLock(locked) {
  isQuizLocked = locked;
  document.querySelectorAll(".ai-btn").forEach(btn => {
    btn.disabled = locked;  // 禁用所有 AI 功能按钮
  });
  const inputEl = document.getElementById("chat-input");
  if (locked) {
    inputEl.placeholder = "🔒 试炼进行中，必须输入你的推演答案才能解锁...";
    inputEl.focus();  // 自动聚焦输入框
  }
}
```

**锁死触发条件**: 当执行 `quiz`（沙盘推演测验）Skill 且 AI 成功返回内容后 → `setQuizLock(true)`  
**锁死解除条件**: 用户必须通过输入框提交回答（`handleUserInput()` 中检测 `isQuizLocked` 后调用 `setQuizLock(false)`）  
**锁死范围**: 所有 `.ai-btn` 按钮（CSS 中 `.ai-btn:disabled` 设置了 `pointer-events: none`），但输入框和发送按钮保持可用  
**设计意图**: 强制用户完成推演，防止跳过思考环节直接请求下一个 AI 功能

---

## 4. 核心排版与 CSS 审查

### 4.1 `library.css` 中 `.p-text`（知识晶体）排版属性

**文件位置**: [library.css](file:///e:/AIReader/library.css)

`.p-text` 在文件中出现两次定义（**存在样式覆盖，需注意优先级**）：

#### 第一次定义（基础样式，第 56 行附近）

```css
.p-text {
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  color: var(--text);
}
```

#### 第二次定义（Markdown 精装样式，第 120 行附近）

```css
.p-text {
  font-size: 14.5px;        /* 覆盖为 14.5px */
  color: #e6edf3;           /* 覆盖为固定色值，而非 CSS 变量 */
}
.p-text p {
  margin-bottom: 12px;
  line-height: 1.75;
  text-align: justify;
}
.p-text ul, .p-text ol {
  padding-left: 24px;
  margin-top: 6px;
  margin-bottom: 12px;
}
.p-text li {
  margin-bottom: 6px;
  line-height: 1.75;
}
.p-text strong {
  color: var(--accent);
  font-weight: 600;
  background: rgba(88, 166, 255, 0.1);
  padding: 0 4px;
  border-radius: 4px;
}
.p-text h1, .p-text h2, .p-text h3, .p-text h4 {
  color: #fff;
  margin-top: 20px;
  margin-bottom: 10px;
  font-weight: 600;
  line-height: 1.4;
}
.p-text h3 {
  font-size: 18px;
  border-bottom: 1px solid var(--border);
  padding-bottom: 6px;
}
.p-text h4 {
  font-size: 16px;
}
.p-text blockquote {
  border-left: 4px solid var(--accent);
  margin: 12px 0;
  color: var(--text-muted);
  background: rgba(88, 166, 255, 0.05);
  padding: 8px 16px;
  border-radius: 0 4px 4px 0;
}
```

**排版属性汇总**:

| 属性 | 最终值 | 来源 |
|------|--------|------|
| `font-size` | `14.5px` | 第二次定义覆盖 |
| `line-height` | `1.6`（基础）→ `1.75`（`p` 子元素） | 段落内为 1.75 |
| `color` | `#e6edf3`（固定） | 第二次定义覆盖 |
| `white-space` | `pre-wrap` | 保留自第一次定义 |
| `margin-bottom`（`p`） | `12px` | 第二次定义 |
| `text-align`（`p`） | `justify` | 第二次定义 |

**潜在问题**:
- 两次 `.p-text` 定义存在属性覆盖，`white-space: pre-wrap` 来自第一次定义，但第二次定义没有显式重置，当前是**合并生效**（CSS 级联规则），但维护时容易混淆
- `.p-text` 的 `color` 第二次定义使用了固定值 `#e6edf3`，而非 CSS 变量 `var(--text)`，这意味着深色/浅色主题切换时知识晶体的文字颜色**不会跟随主题变化**（但 `library.css` 本身也没有深色主题切换机制，此处影响有限）

### 4.2 `reader.css` 中 `.chat-msg .bubble`（AI 聊天气泡）排版属性

**文件位置**: [reader.css](file:///e:/AIReader/reader.css)

#### 用户气泡

```css
.chat-msg.user .bubble {
  background: var(--accent-subtle);
  color: var(--accent);
  border-radius: 12px 12px 0 12px;
  padding: 12px;
  max-width: 85%;
  font-size: 13px;
  line-height: 1.6;
  word-break: break-word;
}
```

#### AI 气泡

```css
.chat-msg.ai .bubble {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 12px 12px 12px 0;
  padding: 12px;
  max-width: 95%;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text);
  word-break: break-word;
  white-space: pre-wrap;     /* 注意：用户气泡无此属性 */
}
```

**排版属性汇总**:

| 属性 | 用户气泡 | AI 气泡 |
|------|----------|---------|
| `font-size` | `13px` | `13px` |
| `line-height` | `1.6` | `1.6` |
| `padding` | `12px` | `12px` |
| `max-width` | `85%` | `95%` |
| `color` | `var(--accent)` | `var(--text)` |
| `word-break` | `break-word` | `break-word` |
| `white-space` | 未设置（默认 `normal`） | `pre-wrap` |

**排版偏小分析**:
- **`font-size: 13px`** 是聊天气泡偏小的根因。在 1920px+ 宽度的显示器上，AI 面板占 30% 宽度 ≈ 576px，13px 的字体在 1.6 行高下每行约 40-45 个中文字符，对长时间阅读确实偏小
- AI 气泡的 `white-space: pre-wrap` 确保 Markdown 渲染后的换行和空格被保留，但用户气泡不设置此属性（用户消息通常较短，影响不大）
- 气泡内部没有针对 `marked` 渲染产物的进一步样式覆盖（如 `h1`-`h4`、`code`、`blockquote` 等），AI 输出的 Markdown 标题、代码块等元素会**继承浏览器默认样式**，可能显得突兀

### 4.3 `txtToEpubArrayBuffer` 注入的内联样式

**文件位置**: [skills/library.js](file:///e:/AIReader/skills/library.js) 中的 `txtToEpubArrayBuffer()` 函数

```html
<style>
  body {
    font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
    font-size: 1.15em;
    line-height: 1.7;
    padding: 2% 4%;
    color: inherit;
  }
  p {
    margin: 0.8em 0;
    text-align: justify;
  }
</style>
```

**注入属性汇总**:

| 属性 | 值 | 作用域 |
|------|-----|--------|
| `font-family` | `-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif` | `body` |
| `font-size` | `1.15em` | `body` |
| `line-height` | `1.7` | `body` |
| `padding` | `2% 4%` | `body` |
| `color` | `inherit` | `body` |
| `margin` | `0.8em 0` | `p` |
| `text-align` | `justify` | `p` |

**排版分析**:
- `font-size: 1.15em` 是相对于父元素的倍数——在 epub.js 的 iframe 中，默认基准值通常是 `16px`（浏览器默认），因此实际渲染约 `18.4px`，属于正常阅读字号
- `line-height: 1.7` 提供舒适的阅读间距
- `color: inherit` 是**关键设计**——不设置固定颜色，而是继承 epub.js 主题系统的颜色变量

### 4.4 epub.js 渲染 TXT 时注入样式可能未生效的根因分析

**问题链路**: 当 TXT 通过 `txtToEpubArrayBuffer` 转换为 EPUB 后，`chapter.html` 中包含内联 `<style>`。但 epub.js 在渲染时通过 `rendition.themes.register()` 注册了主题样式，这些主题样式**可能覆盖**内联样式。

**具体覆盖机制**（[reader.js](file:///e:/AIReader/skills/reader.js) 第 173-180 行）:

```javascript
rendition.themes.register("light", {
  "body": { "background": "transparent", "color": "#1A1D20 !important" },
  "p, div, span, h1, h2, h3, h4": { "color": "#1A1D20 !important" }
});
rendition.themes.register("dark", {
  "body": { "background": "transparent", "color": "#c9d1d9 !important" },
  "p, div, span, h1, h2, h3, h4": { "color": "#c9d1d9 !important" }
});
```

**根因分析**:

1. **主题注册覆盖了颜色，但未覆盖字号和行距**:
   - `rendition.themes.register` 只设置了 `background` 和 `color`，**没有设置 `font-size`、`line-height`、`margin`** 等排版属性
   - 因此 TXT 内联样式中的 `font-size: 1.15em`、`line-height: 1.7`、`margin: 0.8em 0` 理论上**不会被覆盖**，应该正常生效

2. **实际上排版偏小的真正原因**:
   - 如果用户感觉排版偏小，问题可能不在样式覆盖，而在于 **`font-size: 1.15em` 的基准值**
   - epub.js 在 iframe 中渲染时，`<html>` 或 `<body>` 的默认 `font-size` 可能是浏览器默认的 `16px`，`1.15em = 18.4px`
   - 但对于长期阅读场景，`18.4px` 可能仍显保守。建议改为 `1.25em`（约 20px）或直接使用 `px` 值如 `font-size: 20px`
   - 另外，`rendition.themes.register` **缺少 `default font-size` 设定**，如果 epub.js 内部有 reset 样式重置了 body 的 font-size，那么 `1.15em` 的基准会变小

3. **`color: inherit` 与主题的冲突**:
   - TXT 内联样式中 `body { color: inherit }` —— 这个 `inherit` 继承的是 epub.js iframe 的父级颜色
   - 但 `rendition.themes.register` 中 `p { color: #xxx !important }` 使用了 `!important`，会**强制覆盖** `inherit` 值
   - 这是**正确的行为**——主题应该控制颜色，内联样式不做颜色决策

4. **iframe 隔离问题**:
   - epub.js 将内容渲染在独立的 iframe 中（`book.renderTo("viewer")` 创建的）
   - 外部 `reader.css` 中的样式**无法穿透 iframe 边界**影响书籍内容
   - 书籍内容的样式完全由以下三者决定：TXT 内联样式 + epub.js 默认样式 + `rendition.themes.register` 注册的主题
   - 这解释了为什么 reader.css 中对 `.viewer` 的样式设置不会影响书籍内部的排版

**结论**: 排版偏小不是因为样式被覆盖，而是因为：
- `font-size: 1.15em` 在 16px 基准下 = 18.4px，本身偏保守
- `rendition.themes.register` 未设置 `font-size` 作为 fallback
- iframe 隔离导致外部 CSS 无法干预

---

## 5. 分页引擎审查

### 5.1 `book.locations.generate(2000)` 逻辑定位

**文件位置**: [skills/reader.js](file:///e:/AIReader/skills/reader.js) 第 202-215 行

```javascript
book.ready.then(function () {
  const generatePromise = book.locations.generate(2000);
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("计算超时")), 8000)
  );
  return Promise.race([generatePromise, timeoutPromise]);
}).then(function () {
  updatePageIndicator();
}).catch(function (err) {
  console.warn("分页计算中止 (文件过大):", err);
  pageIndicator.textContent = "●";
});
```

**参数分析**:
- `book.locations.generate(2000)`: 参数 `2000` 是**字符跨度（chars per section）**，epub.js 按每 2000 个字符计算一个 CFI location 点
- 值越小 → location 点越多 → 页码越精确 → 但计算时间越长，越容易超时
- 值越大 → location 点越少 → 计算越快 → 但页码精度越低

**超时保护**:
- 8 秒 `Promise.race` 超时降级
- 超时后显示 `●` 而非崩溃
- 但超时后 `updatePageIndicator()` 不会被调用，后续翻页 `pageIndicator` 将永久显示 `●`

**超时原因分析**:
- 大文件（如 10MB+ 的 EPUB）在 `flow: "paginated"` 模式下，epub.js 需要计算每个页面对应的 CFI 位置
- `generate(2000)` 虽然是字符级跨度，但 epub.js 内部仍需遍历整个 spine 来计算分页断点
- 对于包含大量 `spine items` 的 EPUB（如每章一个文件），遍历开销是 `O(n)` 的

### 5.2 替代方案：基于 Spine 索引的粗略阅读百分比

**核心思路**: 不调用 `book.locations.generate()`，而是通过 `book.spine` 的当前索引来计算阅读进度。

```javascript
// 备选实现方案（伪代码）
function updatePagePercentage() {
  if (!rendition || !book) return;

  const location = rendition.currentLocation();
  if (!location || !location.start) return;

  const spineItems = book.spine.items;  // 或 book.spine.spineItems
  const currentIndex = location.start.index;  // 当前 spine item 索引
  const totalItems = spineItems.length;

  // 方案 A: 纯 spine 索引百分比
  const percentage = Math.round((currentIndex / totalItems) * 100);
  pageIndicator.textContent = `${percentage}%`;

  // 方案 B: 结合 spine 内部偏移（更精确）
  // 获取当前 spine item 内的相对位置
  const currentItem = spineItems[currentIndex];
  const docWidth = currentItem.document.body.scrollWidth;
  const docHeight = currentItem.document.body.scrollHeight;
  // 基于 rendition 的视口位置估算当前段内偏移
  // ...
}
```

**可行性分析**:

| 维度 | `locations.generate(2000)` (当前) | Spine 索引百分比 (替代) |
|------|-----------------------------------|------------------------|
| **计算开销** | 高（O(n) 遍历全书，8秒超时） | 几乎为零（O(1) 读取索引） |
| **卡死风险** | 高（大文件直接超时） | 无 |
| **精度** | 精确到页 | 粗糙（仅到章节级别） |
| **用户体验** | 等待 8 秒后可能降级为 `●` | 立即可用，实时更新 |
| **实现复杂度** | 低（epub.js 内置 API） | 低（仅需读取 spine 索引） |
| **可读性** | `"123 / 456"` 格式 | `"34%"` 格式 |

**推荐方案**: **混合模式**

```javascript
// 1. 先立即显示 spine 百分比（零等待）
const spinePct = Math.round((location.start.index / book.spine.spineItems.length) * 100);
pageIndicator.textContent = `${spinePct}%`;

// 2. 异步生成精确页码（可选，不阻塞 UI）
book.ready.then(() => {
  return book.locations.generate(2000);
}).then(() => {
  updatePageIndicator();  // 替换为精确页码
}).catch(() => {
  // 保持 spine 百分比，不降级
});
```

**关键技术细节**:
- `location.start.index` 是 epub.js 内部 location 对象的属性，指向当前 `book.spine` 中的索引位置
- 需要通过 `book.spine.spineItems` 或 `book.spine.items` 获取总长度（具体属性名取决于 epub.js 版本）
- `rendition.on("relocated", callback)` 已注册，每次翻页都会触发回调，可以在此更新百分比
- 百分比显示比页码更直观，无需用户理解"456 页中第 123 页"的绝对页码概念

**迁移风险评估**:
- **低风险**: `location.start.index` 是 epub.js 的核心属性，在所有版本中都存在
- **兼容性**: 需要确认 `book.spine` 的 `items`/`spineItems`/`length` 属性在项目使用的 epub.js 版本中的准确名称
- **回退**: 可以同时保留 `locations.generate()` 逻辑作为可选的精确模式，`spine` 百分比作为默认模式

---

## 总结与建议优先级

| 优先级 | 问题 | 建议 |
|--------|------|------|
| **P0** | `book.locations.generate(2000)` 大文件超时卡死 | 实现 spine 索引百分比替代方案，8秒超时内未完成则永远显示 `●` 不可接受 |
| **P0** | 聊天气泡 `font-size: 13px` 偏小 | 建议提升至 `14px` 或 `15px`，`line-height` 从 `1.6` 提升至 `1.7` |
| **P1** | TXT 内联 `font-size: 1.15em` 偏保守 | 建议提升至 `1.25em` 或 `20px`，确保阅读舒适度 |
| **P1** | `rendition.themes.register` 缺少 `font-size` 设定 | 建议在主题中显式声明 `"body": { "font-size": "18px" }` 作为 fallback |
| **P2** | `library.css` 中 `.p-text` 重复定义 | 合并为单一定义，消除维护歧义 |
| **P2** | `manifest.json` 中 `icons` 为空对象 | 补充 16/48/128 尺寸图标 |
| **P3** | AI 气泡内 Markdown 元素无样式 | 为 `marked` 渲染产物（h1-h4, code, blockquote等）添加气泡内样式 |