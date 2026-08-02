/* ============================================
   AIReader - 核心阅读引擎 v2.0
   Vanilla JS · 零依赖 · 高内聚
   断点续传 · 目录导航 · DOM 文本提取 · 防并发请求
   ============================================ */

(function () {
  "use strict";

  // ---------- DOM 引用 ----------
  const viewerContainer = document.getElementById("viewer-container");
  const viewer = document.getElementById("viewer");
  const bookTitle = document.getElementById("book-title");
  const pageIndicator = document.getElementById("page-indicator");
  const btnClose = document.getElementById("btn-close");
  const btnTheme = document.getElementById("btn-theme");
  const btnPrev = document.getElementById("btn-prev");
  const btnNext = document.getElementById("btn-next");
  const chatContainer = document.getElementById("chat-container");
  const btnToc = document.getElementById("btn-toc");
  const tocPanel = document.getElementById("toc-panel");
  const tocList = document.getElementById("toc-list");


  // ---------- 主题状态 ----------
  let currentTheme = localStorage.getItem("aireader-theme") || "light";
  document.documentElement.setAttribute("data-theme", currentTheme);

  // ---------- 语言状态 ----------
  let currentLang = localStorage.getItem("aireader-lang") || "zh";
  const btnLang = document.getElementById("btn-lang");
  if (btnLang) btnLang.textContent = currentLang === "zh" ? "中" : "En";

  if (btnLang) {
    btnLang.addEventListener("click", () => {
      currentLang = currentLang === "zh" ? "en" : "zh";
      btnLang.textContent = currentLang === "zh" ? "中" : "En";
      localStorage.setItem("aireader-lang", currentLang);
    });
  }

  // ---------- 阅读器状态 ----------
  let book = null;
  let rendition = null;
  let currentBookMeta = null;
  let isQuizLocked = false;
  let isBusy = false;

  // ---------- epub.js 主题注入 ----------
  function applyEpubTheme() {
    if (rendition) {
      rendition.themes.select(currentTheme);
    }
  }

  function toggleTheme() {
    currentTheme = currentTheme === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", currentTheme);
    localStorage.setItem("aireader-theme", currentTheme);
    applyEpubTheme();
  }

  // ---------- 辅助函数 ----------
  function showViewer(show) {
    // reader 页没有独立拖拽区，只控制阅读容器显隐
    viewerContainer.style.display = show ? "flex" : "none";
  }

  function setQuizLock(locked) {
    isQuizLocked = locked;
    refreshActionState();
    const inputEl = document.getElementById("chat-input");
    if (inputEl) {
      if (locked) {
        inputEl.placeholder = "🔒 试炼进行中，必须输入你的完整推演答案才能解锁...";
        inputEl.focus();
      } else {
        inputEl.placeholder = "输入你的推演或向导师提问...";
      }
    }
  }

  // 操作状态刷新：请求进行中或锁死时禁用 AI 按钮，请求中同时禁用发送
  function refreshActionState() {
    const lockedOrBusy = isQuizLocked || isBusy;
    document.querySelectorAll(".ai-btn").forEach(btn => {
      btn.disabled = lockedOrBusy;
    });
    const sendBtn = document.getElementById("btn-send");
    if (sendBtn) sendBtn.disabled = isBusy;
  }

  function setBusy(busy) {
    isBusy = busy;
    refreshActionState();
  }

  function addStarButtonToBubble(bubbleNode, textContent) {
    const actionContainer = document.createElement("div");
    actionContainer.style.display = "flex";
    actionContainer.style.justifyContent = "flex-end";
    actionContainer.style.gap = "8px";
    actionContainer.style.marginTop = "12px";

    // 复制按钮
    const btnCopy = document.createElement("button");
    btnCopy.className = "btn-star";
    btnCopy.style.marginTop = "0"; // 覆盖原生 margin
    btnCopy.innerHTML = "📋 复制文本";
    btnCopy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(textContent);
        const originalText = btnCopy.innerHTML;
        btnCopy.innerHTML = "✅ 已复制";
        btnCopy.classList.add("saved");
        setTimeout(() => {
          btnCopy.innerHTML = originalText;
          btnCopy.classList.remove("saved");
        }, 2000);
      } catch(e) {
        console.error("复制失败", e);
      }
    };

    // 收藏晶体按钮
    const btnStar = document.createElement("button");
    btnStar.className = "btn-star";
    btnStar.style.marginTop = "0";
    btnStar.title = "提炼为原则并收藏至第二大脑";
    btnStar.innerHTML = "🌟 收藏为知识晶体";
    btnStar.onclick = async () => {
      try {
        await window.savePrincipleToDB({
          text: textContent,
          timestamp: Date.now(),
          bookName: currentBookMeta || "未命名书籍"
        });
        btnStar.innerHTML = "⭐ 已永久收藏";
        btnStar.classList.add("saved");
      } catch(e) {
        console.error("收藏失败", e);
      }
    };

    actionContainer.appendChild(btnCopy);
    actionContainer.appendChild(btnStar);
    bubbleNode.appendChild(actionContainer);
  }

  function updatePageIndicator() {
    if (!rendition || !book) return;
    const location = rendition.currentLocation();
    if (location && location.start) {
      if (currentBookMeta) {
        const saveObj = {};
        // 进度键加 progress: 前缀，防止与 apikey/model/endpoint 等配置键冲突
        saveObj["progress:" + currentBookMeta] = location.start.cfi;
        chrome.storage.local.set(saveObj);
      }
      
      // 使用 spine 索引计算百分比进度，彻底解决计算卡死问题
      if (book.spine) {
        const spineItems = book.spine.spineItems || book.spine.items;
        if (spineItems && spineItems.length > 0) {
          const currentIndex = location.start.index;
          // 确保进度在 1% 到 100% 之间
          const percentage = Math.min(100, Math.max(1, Math.round(((currentIndex + 1) / spineItems.length) * 100)));
          pageIndicator.textContent = `${percentage}%`;
        }
      }
    }
  }

  // ---------- EPUB 加载 ----------
  async function loadEpub(bookData) {
    try {
      // 这里的 bookData 是 { name: string, data: ArrayBuffer }
      book = ePub(bookData.data);
      currentBookMeta = bookData.name.replace(/\.epub$/i, "");
      bookTitle.textContent = currentBookMeta;


      // 先确保容器可见（修复首屏空白）
      viewer.innerHTML = "";
      viewerContainer.style.display = "flex";

      rendition = book.renderTo("viewer", {
        width: "100%",
        height: "100%",
        spread: "none",
        flow: "paginated"
      });

      // 注册 epub.js 内部主题，强行穿透 iframe 设置大字号与行距
      rendition.themes.register("light", {
        "body": { "background": "transparent", "color": "#1A1D20 !important", "font-size": "18px !important", "line-height": "1.8 !important" },
        "p, div, span, h1, h2, h3, h4": { "color": "#1A1D20 !important" }
      });
      rendition.themes.register("dark", {
        "body": { "background": "transparent", "color": "#c9d1d9 !important", "font-size": "18px !important", "line-height": "1.8 !important" },
        "p, div, span, h1, h2, h3, h4": { "color": "#c9d1d9 !important" }
      });

      // 注册位置变化回调
      rendition.on("relocated", updatePageIndicator);

      // 应用主题
      applyEpubTheme();

      // 读取上次阅读位置（按 progress: 前缀隔离，防止 CFI 串位与配置键冲突）
      let startCfi = undefined; // 必须是 undefined，绝不能是 null
      const progressKey = "progress:" + currentBookMeta;
      try {
        const stored = await chrome.storage.local.get([progressKey]);
        if (stored[progressKey]) {
          startCfi = stored[progressKey];
        }
      } catch (e) { /* 忽略 */ }

      await rendition.display(startCfi);

      // 书籍就绪后直接显示进度百分比，并加载目录
      book.ready.then(function () {
        updatePageIndicator();
        loadTOC();
      });

    } catch (err) {
      console.error("EPUB 加载失败:", err);
      appendChatMessage("ai", "❌ 文件加载失败: " + err.message);
    }
  }

  // ---------- 关闭书籍 ----------
  function closeBook() {
    if (rendition) { rendition.destroy(); rendition = null; }
    book = null; currentBookMeta = null;
    bookTitle.textContent = "未命名书籍";
    pageIndicator.textContent = "—";
    viewer.innerHTML = "";
    showViewer(false);
    clearToc();
    closeExtractModal();
  }

  // ---------- 目录导航（epub.js loaded.navigation） ----------
  let tocItems = [];

  function flattenToc(items, depth, out) {
    (items || []).forEach(function (item) {
      const label = (item.label && item.label.text) || item.label || "未命名章节";
      out.push({ href: item.href, label: label, depth: depth });
      if (item.subitems && item.subitems.length) {
        flattenToc(item.subitems, depth + 1, out);
      }
    });
    return out;
  }

  async function loadTOC() {
    try {
      let nav = null;
      if (book && book.loaded && book.loaded.navigation) {
        nav = await book.loaded.navigation;
      } else if (book && book.navigation) {
        nav = await book.navigation;
      }
      tocItems = (nav && nav.toc) ? nav.toc : (book && Array.isArray(book.toc) ? book.toc : []);
    } catch (e) {
      tocItems = [];
    }
    renderToc();
  }

  function clearToc() {
    tocItems = [];
    if (tocList) tocList.innerHTML = "";
    if (tocPanel) tocPanel.classList.remove("open");
  }

  function renderToc() {
    if (!tocList) return;
    tocList.innerHTML = "";
    if (!tocItems.length) {
      const empty = document.createElement("div");
      empty.className = "toc-empty";
      empty.textContent = "本书暂无目录（TXT 转换书暂不支持章节跳转）";
      tocList.appendChild(empty);
      return;
    }
    const flat = [];
    flattenToc(tocItems, 0, flat);
    flat.forEach(function (item) {
      const el = document.createElement("div");
      el.className = "toc-item toc-depth-" + Math.min(item.depth, 4);
      el.textContent = item.label;
      el.title = "跳转到该章节";
      el.addEventListener("click", function () {
        if (!rendition || !item.href) return;
        rendition.display(item.href).catch(function (err) {
          console.error("目录跳转失败:", err);
        });
        if (tocPanel) tocPanel.classList.remove("open");
      });
      tocList.appendChild(el);
    });
  }

  if (btnToc && tocPanel) {
    btnToc.addEventListener("click", function () {
      tocPanel.classList.toggle("open");
    });
  }
    // ---------- 初始化: 解析 URL 参数加载书籍 ----------
  const urlParams = new URLSearchParams(window.location.search);
  const targetBookName = urlParams.get('book');

  if (targetBookName) {
    window.getBookFromDB(targetBookName).then(function(bookData) {
      if (bookData && bookData.data) {
        loadEpub(bookData);
      } else {
        alert("未在本地数据库找到该书籍！");
        window.location.href = "library.html";
      }
    }).catch(e => console.error("读取书籍失败", e));
  } else {
    // 如果没有参数，跳转回大厅
    window.location.href = "library.html";
  }

  // 绑定返回大厅按钮
  document.getElementById("btn-home").addEventListener("click", () => {
    window.location.href = "library.html";
  });

  // ---------- 翻页 ----------
  function prevPage() {
    if (rendition) {
      rendition.prev();
    }
  }

  function nextPage() {
    if (rendition) {
      rendition.next();
    }
  }

  // ---------- 对话历史 ----------
  let chatHistory = [{ role: "system", content: SYSTEM_PROMPT }];
  const MAX_HISTORY_ROUNDS = 12;
  const SKILL_MAX_TOKENS = { history: 2500, chapter: 4000, explain: 2500, quiz: 2000 };

  // 有界会话：只保留 system + 最近 MAX_HISTORY_ROUNDS 轮，防止上下文无限膨胀
  function pushHistory(message) {
    chatHistory.push(message);
    const maxMessages = 1 + MAX_HISTORY_ROUNDS * 2;
    if (chatHistory.length > maxMessages) {
      chatHistory = [chatHistory[0]].concat(chatHistory.slice(chatHistory.length - maxMessages + 1));
    }
  }

  // ---------- 对话气泡渲染 ----------
  function appendChatMessage(role, text, isLoading) {
    // 移除 placeholder
    var placeholder = chatContainer.querySelector(".chat-placeholder");
    if (placeholder) placeholder.remove();

    var msg = document.createElement("div");
    msg.className = "chat-msg " + role;

    var bubble = document.createElement("div");
    bubble.className = "bubble";
    if (isLoading) bubble.classList.add("loading");
    bubble.textContent = text;

    msg.appendChild(bubble);
    chatContainer.appendChild(msg);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    return bubble;
  }

  // ---------- 可见文本提取（用于自由输入上下文） ----------
  function getVisibleText() {
    if (!rendition) return "";
    try {
      var contents = rendition.getContents();
      if (contents && contents.length > 0) {
        return (contents[0].document.body.textContent || contents[0].document.body.innerText || "").trim();
      }
    } catch (e) {}
    return "";
  }

  // ---------- 一键提取全书框架 ----------
  const btnExtract = document.getElementById("btn-extract");
  const extractModal = document.getElementById("extract-modal");
  const extractProgressWrap = document.getElementById("extract-progress-wrap");
  const extractProgressFill = document.getElementById("extract-progress-fill");
  const extractProgressText = document.getElementById("extract-progress-text");
  const extractStatus = document.getElementById("extract-status");
  const extractResult = document.getElementById("extract-result");
  const extractActions = document.getElementById("extract-actions");
  const extractCancel = document.getElementById("extract-cancel");
  let extractMarkdownCache = "";
  let extractRunning = false;

  function openExtractModal() {
    if (extractModal) extractModal.classList.add("open");
  }

  function closeExtractModal() {
    // 提取进行中不允许被动关闭：必须显式确认取消
    if (extractRunning && !confirm("提取正在进行，确定要取消吗？")) return;
    if (typeof window.cancelExtraction === "function") window.cancelExtraction();
    if (extractModal) extractModal.classList.remove("open");
    extractRunning = false;
  }

  function resetExtractUI() {
    extractMarkdownCache = "";
    if (extractStatus) extractStatus.innerHTML = "";
    if (extractResult) { extractResult.style.display = "none"; extractResult.innerHTML = ""; }
    if (extractActions) extractActions.style.display = "none";
    if (extractCancel) extractCancel.style.display = "inline-block";
    if (extractProgressWrap) extractProgressWrap.style.display = "block";
    if (extractProgressFill) extractProgressFill.style.width = "0%";
    if (extractProgressText) extractProgressText.textContent = "正在切分章节...";
  }

  function renderExtractProgress(p) {
    if (!p || !extractProgressText || !extractProgressFill) return;
    if (p.phase === "map") {
      const pct = Math.round((p.current / p.total) * 100);
      extractProgressFill.style.width = pct + "%";
      extractProgressText.textContent = p.label + "（" + p.current + "/" + p.total + "）";
      if (extractStatus) {
        const line = document.createElement("div");
        line.className = "extract-status-line";
        if (p.status === "error") line.textContent = "⚠️ " + p.label + "：" + p.error;
        else if (p.status === "done") line.textContent = "✅ " + p.label;
        else line.textContent = "⏳ " + p.label;
        extractStatus.appendChild(line);
        extractStatus.scrollTop = extractStatus.scrollHeight;
        while (extractStatus.children.length > 100) extractStatus.removeChild(extractStatus.firstChild);
      }
    } else if (p.phase === "reduce") {
      extractProgressFill.style.width = "100%";
      extractProgressText.textContent = "正在综合生成全书框架...";
    }
  }

  function showExtractResult(markdown, fromCache) {
    extractMarkdownCache = markdown;
    if (extractProgressWrap) extractProgressWrap.style.display = "none";
    if (extractCancel) extractCancel.style.display = "none";
    if (extractProgressText) {
      extractProgressText.textContent = fromCache ? "已加载缓存结果（可点击「重新提取」更新）" : "提取完成，可复制或下载";
    }
    if (extractResult) {
      extractResult.style.display = "block";
      extractResult.innerHTML = typeof window.renderMarkdown === "function" ? window.renderMarkdown(markdown) : markdown;
    }
    if (extractActions) extractActions.style.display = "flex";
  }

  async function runExtraction(force) {
    if (!book || !currentBookMeta) { alert("请先打开一本书。"); return; }
    let config;
    try { config = await chrome.storage.local.get(["apikey", "endpoint", "model"]); } catch (e) { alert("读取配置失败：" + e.message); return; }
    if (!config.apikey) { alert("请先在扩展选项页配置 API Key。"); return; }
    if (typeof window.extractBookFramework !== "function") { alert("提取模块未加载，请重新加载扩展。"); return; }

    const endpoint = normalizeEndpoint(config.endpoint);
    const model = config.model || "deepseek-v4-flash";
    resetExtractUI();
    openExtractModal();
    extractRunning = true;

    // 缓存命中：同一本书已完成提取则直接展示，避免重复扣费
    if (!force) {
      try {
        const cached = await window.getExtraction(currentBookMeta);
        if (cached && cached.status === "done" && cached.result_markdown) {
          showExtractResult(cached.result_markdown, true);
          extractRunning = false;
          return;
        }
      } catch (e) { /* 缓存读取失败按新提取处理 */ }
    }

    try {
      const outcome = await window.extractBookFramework(book, {
        bookTitle: currentBookMeta,
        apikey: config.apikey,
        endpoint: endpoint,
        model: model,
        onProgress: renderExtractProgress
      });
      if (outcome.cancelled) {
        if (extractProgressText) extractProgressText.textContent = "已取消提取";
        extractRunning = false;
        return;
      }
      const markdown = (outcome.result && outcome.result.framework_markdown) || "";
      if (!markdown) throw new Error("模型未返回有效的框架内容");
      await window.saveExtraction({
        bookName: currentBookMeta,
        status: "done",
        book_summary: outcome.result.book_summary || "",
        result_markdown: markdown,
        chunkCount: outcome.chunkCount,
        updatedAt: Date.now()
      });
      showExtractResult(markdown, false);
      extractRunning = false;
    } catch (e) {
      console.error("全书提取失败:", e);
      if (extractProgressText) extractProgressText.textContent = "❌ 提取失败：" + e.message;
      if (extractCancel) extractCancel.style.display = "inline-block";
      extractRunning = false;
    }
  }

  function copyExtractMarkdown() {
    if (!extractMarkdownCache) return;
    navigator.clipboard.writeText(extractMarkdownCache).then(function () {
      const btn = document.getElementById("extract-copy");
      if (btn) {
        btn.textContent = "✅ 已复制";
        setTimeout(function () { btn.textContent = "📋 复制 Markdown"; }, 2000);
      }
    }).catch(function () { alert("复制失败，请手动选择文本复制。"); });
  }

  function downloadExtractMarkdown() {
    if (!extractMarkdownCache) return;
    const blob = new Blob(["\uFEFF" + extractMarkdownCache], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (currentBookMeta || "AIReader") + "-全书框架.md";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // ---------- 动作调度器（SKILLS 策略驱动） ----------
  async function handleAIAction(actionKey) {
    const skill = SKILLS[actionKey];
    if (!skill || isBusy) return;
    setBusy(true);

    // 1. 获取配置
    let result;
    try { result = await chrome.storage.local.get(["apikey", "endpoint", "model"]); } catch (e) { setBusy(false); return; }
    if (!result.apikey) { appendChatMessage("ai", "⚠️ 请先在扩展选项页配置 API Key。"); setBusy(false); return; }
    const endpoint = normalizeEndpoint(result.endpoint);

    // 2. 提取上下文（调用 Skill 对应的提取方法）
    const bubble = appendChatMessage("ai", "正在执行 [" + skill.name + "]，扫描上下文中...", true);
    const contextResult = await skill.getContext(rendition, book);

    if (contextResult.error || !contextResult.text || contextResult.text.length < 10) {
      bubble.classList.remove("loading");
      bubble.textContent = contextResult.error || "⚠️ 提取到的文本过短，无法分析。";
      setBusy(false);
      return;
    }

    // 3. 构建 Prompt 并推入历史
    const userPrompt = skill.buildPrompt(contextResult.text);
    const finalPrompt = userPrompt + (currentLang === "en" ? "\n\n(Please output your entire response in English.)" : "");
    pushHistory({ role: "user", content: finalPrompt });

    // UI 显示用户发起了该动作 (修改点：必须先上屏 User 气泡)
    appendChatMessage("user", "执行: " + skill.name);

    // 4. 发起流式请求 (修改点：后上屏 AI 气泡)
    const responseBubble = appendChatMessage("ai", "思考中...", true);
    const finalContent = await streamAIResponse(
      chatHistory,
      result.model || "deepseek-v4-flash",
      endpoint,
      result.apikey,
      responseBubble,
      { maxTokens: SKILL_MAX_TOKENS[actionKey] || 3000 }
    );
    setBusy(false);

    if (finalContent) {
      pushHistory({ role: "assistant", content: finalContent });
      addStarButtonToBubble(responseBubble, finalContent);

      if (actionKey === "quiz") {
        setQuizLock(true);
      }
    } else {
      chatHistory.pop();
    }
  }

  // ---------- 用户自由输入处理（流式） ----------
  async function handleUserInput() {
    const inputEl = document.getElementById("chat-input");
    if (!inputEl) return;
    const text = inputEl.value.trim();
    if (!text) return;
    if (isBusy) return;

    // 盲盒锁死：必须提交足够完整的推演才解锁，防止无脑回车绕过
    if (isQuizLocked && text.length < 30) {
      appendChatMessage("ai", "⚠️ 推演太短了（至少 30 字）。盲盒锁死：先写下你的完整推演逻辑，导师才会批阅解锁。");
      inputEl.focus();
      return;
    }

    inputEl.value = "";
    appendChatMessage("user", text);

    if (isQuizLocked) {
      setQuizLock(false);
    }
    setBusy(true);

    // 自由提问自动携带当前页上下文，让 AI 真正"读到"你在读的内容
    const visibleText = getVisibleText().substring(0, 2000);
    let userContent = text;
    if (visibleText) {
      userContent = "【当前页上下文（来自你正在阅读的书籍，仅供 AI 参考；回答请以用户问题为准）】\n" + visibleText + "\n\n【用户问题】\n" + text;
    }
    userContent += (currentLang === "en" ? "\n\n(Please output your entire response in English.)" : "");
    pushHistory({ role: "user", content: userContent });

    let result;
    try { result = await chrome.storage.local.get(["apikey", "endpoint", "model"]); } catch (e) { setBusy(false); return; }
    const endpoint = normalizeEndpoint(result.endpoint);

    const bubble = appendChatMessage("ai", "导师批阅中...", true);
    const finalContent = await streamAIResponse(chatHistory, result.model || "deepseek-v4-flash", endpoint, result.apikey, bubble);
    setBusy(false);

    if (finalContent) {
      pushHistory({ role: "assistant", content: finalContent });
      addStarButtonToBubble(bubble, finalContent);
    } else {
      chatHistory.pop();
    }
  }

  // ---------- 事件绑定 ----------

  // 关闭按钮
  btnClose.addEventListener("click", closeBook);

  // 主题切换按钮
  btnTheme.addEventListener("click", toggleTheme);

  // 翻页按钮
  btnPrev.addEventListener("click", prevPage);
  btnNext.addEventListener("click", nextPage);

  // 键盘翻页
  document.addEventListener("keydown", function (e) {
    if (!rendition) return;
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

    if (e.key === "ArrowLeft") {
      e.preventDefault();
      rendition.prev();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      rendition.next();
    }
  });

  // AI 动作按钮
  document.querySelectorAll(".ai-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var action = btn.dataset.action;
      handleAIAction(action);
    });
  });

  // 全书提取
  if (btnExtract) btnExtract.addEventListener("click", function () { runExtraction(false); });
  const extractClose = document.getElementById("extract-close");
  if (extractClose) extractClose.addEventListener("click", closeExtractModal);
  if (extractCancel) {
    extractCancel.addEventListener("click", function () {
      if (typeof window.cancelExtraction === "function") window.cancelExtraction();
      if (extractProgressText) extractProgressText.textContent = "正在取消...";
    });
  }
  const extractCopyBtn = document.getElementById("extract-copy");
  if (extractCopyBtn) extractCopyBtn.addEventListener("click", copyExtractMarkdown);
  const extractDownloadBtn = document.getElementById("extract-download");
  if (extractDownloadBtn) extractDownloadBtn.addEventListener("click", downloadExtractMarkdown);
  const extractAgainBtn = document.getElementById("extract-again");
  if (extractAgainBtn) extractAgainBtn.addEventListener("click", function () { runExtraction(true); });
  // 发送按钮事件
  document.getElementById("btn-send").addEventListener("click", handleUserInput);

  // 输入框回车发送（Shift+Enter 换行）
  document.getElementById("chat-input").addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleUserInput();
    }
  });

 

})();
