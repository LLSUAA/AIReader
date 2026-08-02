/* ============================================
   AIReader - 全书框架分层提取管线（Map-Reduce）
   第一层：结构解析（spine/章节，零幻觉）
   第二层：逐块摘要 Map（每块独立 JSON）
   第三层：全局综合 Reduce（只吃摘要，不吃原文）
   配套：取消机制、单块失败容错、结果由 db.js 缓存
   ============================================ */
(function (global) {
  "use strict";

  const CHUNK_CHARS = 8000;   // 单块最大字符数（约 4-6K tokens）
  const MAX_CHUNKS = 80;      // 全书最大块数上限，防止极端大书无限调用
  const MIN_CHUNK_TEXT = 200; // 过短片段（封面/空白页）跳过

  let activeAbort = null;

  global.cancelExtraction = function () {
    if (activeAbort) activeAbort.abort();
  };

  // ---------- 第一层：结构解析 ----------
  // EPUB 按 spine item（通常=章节）切分；超长单章节（如 TXT 转换书）再按段落簇切分
  function splitLongText(text, label, chunks) {
    const paragraphs = text.split(/\n+/).map(s => s.trim()).filter(s => s.length > 0);
    if (paragraphs.length <= 1) {
      chunks.push({ label: label, text: text.substring(0, CHUNK_CHARS) });
      return;
    }
    let current = [];
    let currentLen = 0;
    let part = 0;
    for (const p of paragraphs) {
      if (currentLen + p.length > CHUNK_CHARS && current.length) {
        part++;
        chunks.push({ label: label + (part > 1 ? "（第" + part + "部分）" : ""), text: current.join("\n\n") });
        current = [];
        currentLen = 0;
      }
      current.push(p);
      currentLen += p.length;
    }
    if (current.length) {
      part++;
      chunks.push({ label: label + (part > 1 ? "（第" + part + "部分）" : ""), text: current.join("\n\n") });
    }
  }

  global.buildBookChunks = async function (book) {
    const chunks = [];
    const spineItems = (book.spine && (book.spine.spineItems || book.spine.items)) || [];

    for (let i = 0; i < spineItems.length; i++) {
      const item = spineItems[i];
      try {
        await item.load(book.load.bind(book));
        const doc = item.document;
        const text = (
          (doc && doc.body && (doc.body.innerText || doc.body.textContent)) || ""
        ).trim();
        if (!text || text.length < MIN_CHUNK_TEXT) continue;

        // 提取原文章节标题（首个标题元素）：骨架忠实度依赖真实章节名
        let title = "";
        try {
          const heading = doc.body.querySelector("h1, h2, h3, h4");
          if (heading && heading.textContent) {
            title = heading.textContent.trim().replace(/\s+/g, " ");
          }
        } catch (e) { /* 无标题元素则退回序号 */ }
        const label = title ? title : "第" + (i + 1) + "节";
        if (text.length <= CHUNK_CHARS) {
          chunks.push({ label: label, text: text });
        } else {
          splitLongText(text, label, chunks);
        }
      } catch (e) {
        // 单个章节加载失败不阻塞整本书
        console.error("章节加载失败（spine " + i + "）:", e);
      }
      if (chunks.length >= MAX_CHUNKS) break;
    }
    return chunks;
  };

  // ---------- 第二层：逐块摘要（Map） ----------
  const MAP_SYSTEM = "你是一名严谨的书籍结构分析师。你的唯一任务是：只基于用户提供的文本片段提取结构化信息。绝对禁止使用你的训练记忆补充、脑补或编造片段中不存在的内容。";

  function buildMapPrompt(chunk, index, total, bookTitle) {
    return `请阅读《${bookTitle}》的以下文本片段（${chunk.label}，第 ${index + 1}/${total} 块），提取结构化信息。

必须输出一个 JSON 对象，字段如下：
{
  "title": "本片段所属章节/小节名：若文本中存在章节标题，必须原样使用；否则用不超过20字概括",
  "core_points": ["最多3条核心论点，每条不超过40字，必须能在原文中找到依据"],
  "concepts": [{"name": "关键概念名，不超过12字", "def": "不超过50字的定义"}],
  "relation_to_prev": "与上一块的逻辑关系（承接/转折/并列/递进/新话题），一句话不超过30字",
  "confidence": "high 或 medium 或 low"
}

约束：
1. 只输出 JSON 对象，不要输出任何其他文字或代码围栏。
2. 若片段信息不足以支撑某个论点，不要写，宁缺毋滥。
3. confidence 为 low 时，表示本片段信息密度低或难以确定结构。
4. 若片段包含多个章节/模块，core_points 必须覆盖片段内出现的每一个章节/模块（每个至少一条），禁止只写片段开头的部分。

文本片段：
${chunk.text}`;
  }

  function normalizeChunk(data, fallbackTitle) {
    const d = data && typeof data === "object" ? data : {};
    const corePoints = Array.isArray(d.core_points)
      ? d.core_points.map(String)
      : (d.corePoints ? [String(d.corePoints)] : []);
    const concepts = Array.isArray(d.concepts)
      ? d.concepts.map(c => ({ name: String(c.name || ""), def: String(c.def || "") }))
      : [];
    return {
      chapter: String(d.title || fallbackTitle || "未命名章节"),
      core_points: corePoints.length ? corePoints : ["（该块未能提取出核心论点）"],
      concepts: concepts,
      relation_to_prev: String(d.relation_to_prev || d.relationToPrev || ""),
      confidence: String(d.confidence || "medium")
    };
  }

  function isReasoningError(e) {
    return !!(e && (e.reasoning === true || /思维链|reasoning/i.test(e.message || "")));
  }

  // reasoning 模型兜底：思维链吃光 max_tokens 时，回退到非思维链模型重试
  function fallbackModel(model) {
    const m = String(model || "").toLowerCase();
    return m === "deepseek-chat" ? "" : "deepseek-chat";
  }

  // 通用重试：按 [model, maxTokens] 阶梯尝试；仅 reasoning 类错误才继续下一档
  async function requestWithRetry(messages, options, aborter, attempts, temperature, fallbackRaw) {
    let lastErr = null;
    for (const attempt of attempts) {
      try {
        return await global.requestJSON(
          messages,
          attempt.model,
          options.endpoint,
          options.apikey,
          { maxTokens: attempt.maxTokens, signal: aborter.signal, temperature: temperature, fallbackRaw: !!fallbackRaw }
        );
      } catch (e) {
        if (aborter.signal.aborted) throw e;
        lastErr = e;
        if (!isReasoningError(e)) throw e;
      }
    }
    throw lastErr;
  }

  function buildMapAttempts(model) {
    // 同一模型最多试 2 档，仍失败立即换非思维链模型，避免烧 token 浪费时间
    const attempts = [[model, 4000], [model, 8000]];
    const fb = fallbackModel(model);
    if (fb) attempts.push([fb, 8000]);
    return attempts.map(function (a) { return { model: a[0], maxTokens: a[1] }; });
  }

  function buildReduceAttempts(model) {
    const attempts = [[model, 8000]];
    const fb = fallbackModel(model);
    if (fb) attempts.push([fb, 16000]);
    return attempts.map(function (a) { return { model: a[0], maxTokens: a[1] }; });
  }

  // ---------- 第三层：全局综合（Reduce） ----------
  const REDUCE_SYSTEM = "你是一名知识提取专家。你的唯一任务是：只基于用户提供的结构化章节摘要进行综合归纳，生成全书框架。绝对禁止编造摘要中不存在的内容，禁止引用摘要之外的知识。";

  function buildReducePrompt(results, bookTitle, failedLabels) {
    // 提取失败的分块不进入综合，避免骨架出现"提取失败"占位章节
    const isFailed = function (r) {
      return !!(r.core_points && r.core_points[0] && r.core_points[0].indexOf("该块提取失败") !== -1);
    };
    const usable = results.filter(function (r) { return !isFailed(r); });
    const summaries = usable.map(r => ({
      chapter: r.chapter,
      core_points: r.core_points,
      concepts: r.concepts,
      relation_to_prev: r.relation_to_prev,
      confidence: r.confidence
    }));
    const failedNote = (failedLabels && failedLabels.length)
      ? "\n\n注意：本次有 " + failedLabels.length + " 个分块提取失败（" + failedLabels.join("；") + "）。这些块的内容不可用，禁止虚构；请在框架的溯源说明中注明这些块未能提取。"
      : "";
    return `以下是《${bookTitle}》全部分块的结构化摘要（JSON 数组）。请综合这些摘要，生成全书框架。

必须输出一个 JSON 对象，字段如下：
{
  "book_summary": "一句话定位本书核心主张，不超过40字",
  "framework_markdown": "一页纸全书框架的纯 Markdown 原文。禁止转义、禁止嵌套 JSON、禁止在字段内重复 book_summary。严格按以下结构：
    1. 第一行：# 《书名》全书框架
    2. ## 全书定位：一段话，不超过 3 行
    3. ## 章节骨架：每一篇/章用 ### 三级标题；正文用 - 无序列表，每条一行；关键概念用 **加粗**；尽量标注来源章节名
    4. ## 核心概念关系：只包含一个 Mermaid 代码块（graph TD），节点数量不超过 20，节点用 A[概念名]，边用 -->|关系短语|
    5. ## 论证主线：用 1. 2. 3. 有序列表呈现 A → B → C 的推进链条
    6. ## 溯源说明：固定写一句『本框架基于分块摘要生成，引用前请核对原文。』
    7. 所有标题前后、列表块之间必须留空行；全文禁止出现 JSON、花括号包裹或转义符号"
}

约束：
1. 只输出 JSON 对象，不要输出任何其他文字或代码围栏。
2. framework_markdown 字段内的值必须是 Markdown 原文，禁止把 JSON 对象或转义字符串塞进该字段。
3. 所有内容必须能在给定摘要中找到依据；找不到就省略，不要编造。
4. 章节骨架中每一章的标题必须使用摘要提供的原文章节名，禁止自拟、合并或改名；摘要中出现的所有章节都必须覆盖，每章至少一条要点。
5. 涉及具体数字（层数、占比、概率、年份）时必须与摘要完全一致，禁止改写。
6. Mermaid 中同一概念只能出现一个节点，禁止重复命名。

${failedNote}

分块摘要：
${JSON.stringify(summaries)}`;
  }

  // 降级：模型未按 JSON 输出时，把原始 Markdown 作为框架内容使用
  function rawToMarkdown(text) {
    const raw = String(text || "").replace(/^\uFEFF/, "").trim();
    if (!raw) return "";
    // 跳过模型常见的"好的，以下是..."式前言，从第一个 Markdown 标题开始
    const lines = raw.split(/\r?\n/);
    let start = 0;
    for (let i = 0; i < lines.length; i++) {
      if (/^#{1,6}\s/.test(lines[i])) {
        start = i;
        break;
      }
    }
    return lines.slice(start).join("\n").trim();
  }

  // 模型偶尔会把 framework_markdown 嵌套成 JSON 字符串/对象，统一解包为纯 Markdown
  global.normalizeFrameworkMarkdown = function (raw) {
    if (raw && typeof raw === "object") {
      if (Array.isArray(raw)) {
        return raw.length ? global.normalizeFrameworkMarkdown(raw[0]) : "";
      }
      if (raw.framework_markdown !== undefined) return global.normalizeFrameworkMarkdown(raw.framework_markdown);
      if (raw.markdown !== undefined) return global.normalizeFrameworkMarkdown(raw.markdown);
      return "";
    }
    let text = String(raw || "").trim();
    if (text.startsWith("{")) {
      try {
        // 用容错解析（含尾逗号/缺失逗号/字符串内换行修复），嵌套 JSON 也能解包
        const parsed = global.extractJSONContent(text);
        if (parsed && typeof parsed === "object") return global.normalizeFrameworkMarkdown(parsed);
      } catch (e) { /* 不是 JSON，按原文处理 */ }
    }
    return text;
  };

  // ---------- 调度器 ----------
  global.extractBookFramework = async function (book, options) {
    options = options || {};
    const aborter = new AbortController();
    activeAbort = aborter;

    options.onProgress && options.onProgress({ phase: "start", total: 0, label: "正在切分章节..." });
    const chunks = await global.buildBookChunks(book);
    if (!chunks.length) {
      activeAbort = null;
      throw new Error("未能从本书提取到任何文本，请确认文件内容可读。");
    }

    // Map 阶段：并发工作池（默认 3），支持断点续传（resume）与逐块落盘（onChunkDone）
    const results = new Array(chunks.length).fill(null);
    const resume = options.resume || {};
    let completedCount = 0;
    for (let i = 0; i < chunks.length; i++) {
      if (resume[i] && resume[i].chapter) {
        results[i] = resume[i];
        completedCount++;
      }
    }
    if (completedCount > 0 && options.onProgress) {
      options.onProgress({ phase: "resume", current: completedCount, total: chunks.length, label: "已恢复 " + completedCount + " 块缓存，继续提取..." });
    }

    const CONCURRENCY = 3;
    let nextIndex = 0;

    async function mapWorker() {
      while (!aborter.signal.aborted) {
        const idx = nextIndex++;
        if (idx >= chunks.length) return;
        if (results[idx]) continue; // 断点续传命中
        options.onProgress && options.onProgress({
          phase: "map",
          current: completedCount,
          total: chunks.length,
          label: chunks[idx].label,
          status: "running"
        });
        try {
          const data = await requestWithRetry(
            [
              { role: "system", content: MAP_SYSTEM },
              { role: "user", content: buildMapPrompt(chunks[idx], idx, chunks.length, options.bookTitle || "未命名书籍") }
            ],
            options,
            aborter,
            buildMapAttempts(options.model),
            0.2,
            false
          );
          results[idx] = normalizeChunk(data, chunks[idx].label);
          completedCount++;
          options.onProgress && options.onProgress({
            phase: "map",
            current: completedCount,
            total: chunks.length,
            label: chunks[idx].label,
            status: "done"
          });
        } catch (e) {
          if (aborter.signal.aborted) return;
          completedCount++;
          options.onProgress && options.onProgress({
            phase: "map",
            current: completedCount,
            total: chunks.length,
            label: chunks[idx].label,
            status: "error",
            error: e.message
          });
          // 单块失败不中断全书：写入占位摘要，保证 Reduce 可继续
          results[idx] = normalizeChunk({ title: chunks[idx].label, core_points: ["（该块提取失败：" + e.message + "）"], confidence: "low" }, chunks[idx].label);
        }
        if (typeof options.onChunkDone === "function") {
          try { options.onChunkDone(idx, results[idx]); } catch (e2) { /* 持久化失败不阻塞提取 */ }
        }
      }
    }

    const workers = [];
    const workerCount = Math.min(CONCURRENCY, chunks.length);
    for (let w = 0; w < workerCount; w++) workers.push(mapWorker());
    await Promise.all(workers);

    if (aborter.signal.aborted) return { cancelled: true };
    options.onProgress && options.onProgress({
      phase: "reduce",
      current: results.length,
      total: results.length,
      label: "正在综合生成全书框架..."
    });

    const failedLabels = results
      .filter(r => r.core_points && r.core_points[0] && r.core_points[0].indexOf("该块提取失败") !== -1)
      .map(r => r.chapter);

    let reduceResult;
    try {
      reduceResult = await requestWithRetry(
        [
          { role: "system", content: REDUCE_SYSTEM },
          { role: "user", content: buildReducePrompt(results, options.bookTitle || "未命名书籍", failedLabels) }
        ],
        options,
        aborter,
        buildReduceAttempts(options.model),
        0.3,
        true
      );
    } catch (e) {
      if (aborter.signal.aborted) return { cancelled: true };
      throw e;
    }

    // JSON 解析失败降级：直接用模型输出的 Markdown
    if (reduceResult && reduceResult.__raw) {
      const md = rawToMarkdown(reduceResult.__raw);
      if (!md) throw new Error("模型未返回有效的框架内容");
      reduceResult = { book_summary: "", framework_markdown: md };
    }

    activeAbort = null;
    return { cancelled: false, chunkCount: chunks.length, result: reduceResult };
  };
})(window);
