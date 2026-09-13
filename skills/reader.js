/* ============================================
   读见 - 核心阅读引擎 v2.0
   Vanilla JS · 零依赖 · 高内聚
   断点续传 · 目录导航 · DOM 文本提取 · 防并发请求
   ============================================ */

(function () {
  "use strict";

  const BRAND = window.DUJIAN_BRAND || { name: "读见" };

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
  const app = document.querySelector(".app");
  const aiPane = document.getElementById("ai-pane");
  const btnAiToggle = document.getElementById("btn-ai-toggle");
  const btnModeContinuous = document.getElementById("btn-mode-continuous");
  const btnModePaginated = document.getElementById("btn-mode-paginated");
  const aiStatus = document.getElementById("ai-status");
  const aiStatusText = document.getElementById("ai-status-text");


  // ---------- 主题状态 ----------
  const THEME_STORAGE_KEY = "aireader-theme";
  const READING_MODE_STORAGE_KEY = "dujian:reader:reading-mode:v1";
  const AI_PANE_STORAGE_KEY = "dujian:reader:ai-pane-collapsed:v1";
  let currentTheme = localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
  let readingMode = localStorage.getItem(READING_MODE_STORAGE_KEY) === "paginated" ? "paginated" : "continuous";

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
  let isSwitchingReadingMode = false;
  let progressSaveTimer = null;
  let activeTocHref = "";

  // ---------- epub.js 主题注入 ----------
  function applyEpubTheme() {
    if (rendition) {
      rendition.themes.select(currentTheme + "-" + readingMode);
    }
  }

  // 阅读器外壳、epub.js iframe、偏好持久化和按钮状态必须由同一入口同步。
  function setTheme(theme, persist) {
    currentTheme = theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", currentTheme);
    if (persist !== false) localStorage.setItem(THEME_STORAGE_KEY, currentTheme);
    applyEpubTheme();
    if (btnTheme) {
      const isDark = currentTheme === "dark";
      const label = isDark ? "深色" : "浅色";
      const nextLabel = isDark ? "浅色" : "深色";
      const description = "当前：" + label + "主题，点击切换为" + nextLabel;
      const text = btnTheme.querySelector("span");
      if (text) text.textContent = label;
      btnTheme.dataset.theme = currentTheme;
      btnTheme.setAttribute("aria-pressed", String(isDark));
      btnTheme.setAttribute("title", description);
      btnTheme.setAttribute("aria-label", description);
    }
  }

  function toggleTheme() {
    setTheme(currentTheme === "light" ? "dark" : "light");
  }

  setTheme(currentTheme, false);

  function updateReadingModeUI() {
    if (app) app.dataset.readingMode = readingMode;
    [
      { button: btnModeContinuous, mode: "continuous" },
      { button: btnModePaginated, mode: "paginated" }
    ].forEach(function (item) {
      if (!item.button) return;
      const active = readingMode === item.mode;
      item.button.classList.toggle("active", active);
      item.button.setAttribute("aria-pressed", String(active));
      item.button.disabled = isSwitchingReadingMode;
    });
    if (pageIndicator) {
      pageIndicator.setAttribute("aria-label", readingMode === "continuous" ? "连续阅读进度" : "分页阅读进度");
    }
  }

  function setAiPaneCollapsed(collapsed, persist) {
    if (!aiPane || !btnAiToggle) return;
    aiPane.classList.toggle("is-collapsed", !!collapsed);
    btnAiToggle.setAttribute("aria-expanded", String(!collapsed));
    btnAiToggle.setAttribute("aria-label", collapsed ? "展开陪读工作区" : "收起陪读工作区");
    btnAiToggle.setAttribute("title", collapsed ? "展开陪读工作区" : "收起陪读工作区");
    if (persist !== false) localStorage.setItem(AI_PANE_STORAGE_KEY, collapsed ? "1" : "0");
    requestRenditionResize();
  }

  updateReadingModeUI();
  setAiPaneCollapsed(localStorage.getItem(AI_PANE_STORAGE_KEY) === "1", false);

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
        inputEl.placeholder = "推演进行中：请先写下至少 30 字的完整思路";
        inputEl.focus();
      } else {
        inputEl.placeholder = "写下问题，Enter 发送，Shift + Enter 换行";
      }
    }
  }

  function setWorkspaceStatus(state, text) {
    if (aiStatus) aiStatus.dataset.state = state;
    if (aiStatusText) aiStatusText.textContent = text;
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
    if (busy) setWorkspaceStatus("busy", "陪读进行中");
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
    btnCopy.textContent = "复制文本";
    btnCopy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(textContent);
        const originalText = btnCopy.innerHTML;
        btnCopy.textContent = "已复制";
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
    btnStar.title = "保存到本地知识晶体";
    btnStar.textContent = "收藏为知识晶体";
    btnStar.onclick = async () => {
      try {
        await window.savePrincipleToDB({
          text: textContent,
          timestamp: Date.now(),
          bookName: currentBookMeta || "未命名书籍"
        });
        btnStar.textContent = "已保存到本地";
        btnStar.classList.add("saved");
      } catch(e) {
        console.error("收藏失败", e);
      }
    };

    actionContainer.appendChild(btnCopy);
    actionContainer.appendChild(btnStar);
    bubbleNode.appendChild(actionContainer);
  }

  function getCurrentLocation() {
    if (!rendition) return null;
    try {
      return rendition.currentLocation() || null;
    } catch (err) {
      console.error("读取当前位置失败:", err);
      return null;
    }
  }

  function getCurrentCfi() {
    const location = getCurrentLocation();
    return location && location.start && location.start.cfi;
  }

  function normalizeTocHref(href) {
    const raw = String(href || "").split("#")[0].replace(/^\.\//, "");
    try {
      return decodeURIComponent(raw);
    } catch (e) {
      return raw;
    }
  }

  function updateActiveToc(location) {
    if (!tocList || !location || !location.start) return;
    const sectionHref = normalizeTocHref(location.start.href || "");
    if (!sectionHref || sectionHref === activeTocHref) return;
    activeTocHref = sectionHref;
    let activeEl = null;
    tocList.querySelectorAll(".toc-item").forEach(function (item) {
      const itemHref = normalizeTocHref(item.dataset.href || "");
      const active = !!itemHref && (itemHref === sectionHref || itemHref.endsWith("/" + sectionHref) || sectionHref.endsWith("/" + itemHref));
      item.classList.toggle("active", active);
      if (active) {
        item.setAttribute("aria-current", "location");
        if (!activeEl) activeEl = item;
      } else {
        item.removeAttribute("aria-current");
      }
    });
    if (activeEl && isWideTocLayout()) {
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }

  function updatePageIndicator(relocatedLocation) {
    if (!rendition || !book) return;
    const location = relocatedLocation && relocatedLocation.start ? relocatedLocation : getCurrentLocation();
    if (location && location.start) {
      if (currentBookMeta) {
        clearTimeout(progressSaveTimer);
        progressSaveTimer = setTimeout(function () {
          const saveObj = {};
          // 继续沿用 progress:<书名>，连续模式不引入新的进度数据契约。
          saveObj["progress:" + currentBookMeta] = location.start.cfi;
          chrome.storage.local.set(saveObj);
        }, readingMode === "continuous" ? 240 : 80);
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
      updateActiveToc(location);
    }
  }

  function registerRenditionThemes() {
    if (!rendition) return;
    const continuousLayout = {
      "html": { "background": "#fffefa !important" },
      "body": {
        "box-sizing": "border-box !important",
        "max-width": "780px !important",
        "margin": "0 auto !important",
        "padding": "42px 34px 72px !important",
        "background": "#fffefa !important",
        "color": "#24231f !important",
        "font-size": "18px !important",
        "line-height": "1.85 !important",
        "overflow-wrap": "break-word !important"
      },
      "p, div, span, h1, h2, h3, h4, h5, h6, li": { "color": "#1A1D20 !important" },
      "img, svg, video": { "max-width": "100% !important", "height": "auto !important" },
      "table": { "max-width": "100% !important", "border-collapse": "collapse !important" },
      "pre": { "white-space": "pre-wrap !important", "overflow-wrap": "anywhere !important" }
    };
    const continuousDarkLayout = JSON.parse(JSON.stringify(continuousLayout));
    continuousDarkLayout.html.background = "#1d201c !important";
    continuousDarkLayout.body.background = "#1d201c !important";
    continuousDarkLayout.body.color = "#e7e5dc !important";
    continuousDarkLayout["p, div, span, h1, h2, h3, h4, h5, h6, li"].color = "#e7e5dc !important";

    rendition.themes.register("light-continuous", continuousLayout);
    rendition.themes.register("dark-continuous", continuousDarkLayout);
    rendition.themes.register("light-paginated", {
      "html": { "background": "#fffefa !important" },
      "body": { "background": "#fffefa !important", "color": "#24231f !important", "font-size": "18px !important", "line-height": "1.8 !important" },
      "p, div, span, h1, h2, h3, h4, h5, h6, li": { "color": "#1A1D20 !important" },
      "img, svg, video": { "max-width": "100% !important", "height": "auto !important" }
    });
    rendition.themes.register("dark-paginated", {
      "html": { "background": "#1d201c !important" },
      "body": { "background": "#1d201c !important", "color": "#e7e5dc !important", "font-size": "18px !important", "line-height": "1.8 !important" },
      "p, div, span, h1, h2, h3, h4, h5, h6, li": { "color": "#e7e5dc !important" },
      "img, svg, video": { "max-width": "100% !important", "height": "auto !important" }
    });
  }

  async function createRendition(mode, startCfi) {
    if (!book) return;
    if (rendition) {
      rendition.destroy();
      rendition = null;
    }
    viewer.innerHTML = "";
    const options = {
      width: "100%",
      height: "100%",
      spread: "none",
      flow: mode === "continuous" ? "scrolled-doc" : "paginated"
    };
    if (mode === "continuous") options.manager = "continuous";
    rendition = book.renderTo("viewer", options);
    registerRenditionThemes();
    rendition.on("relocated", updatePageIndicator);
    setTheme(currentTheme, false);
    await rendition.display(startCfi || undefined);
    updatePageIndicator();
  }

  async function switchReadingMode(nextMode) {
    if (nextMode !== "continuous" && nextMode !== "paginated") return;
    if (nextMode === readingMode || isSwitchingReadingMode || !book) return;
    const previousMode = readingMode;
    const currentCfi = getCurrentCfi();
    isSwitchingReadingMode = true;
    readingMode = nextMode;
    updateReadingModeUI();
    try {
      if (currentBookMeta && currentCfi) {
        const saveObj = {};
        saveObj["progress:" + currentBookMeta] = currentCfi;
        await chrome.storage.local.set(saveObj);
      }
      await createRendition(readingMode, currentCfi);
      localStorage.setItem(READING_MODE_STORAGE_KEY, readingMode);
    } catch (err) {
      console.error("切换阅读模式失败:", err);
      readingMode = previousMode;
      try {
        await createRendition(readingMode, currentCfi);
      } catch (restoreErr) {
        console.error("恢复原阅读模式失败:", restoreErr);
      }
      showAIRequestError(null, "无法切换阅读模式，已恢复原模式。你可以关闭书籍后重试。");
    } finally {
      isSwitchingReadingMode = false;
      updateReadingModeUI();
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
      viewerContainer.style.display = "flex";

      // 读取上次阅读位置（按 progress: 前缀隔离，防止 CFI 串位与配置键冲突）
      let startCfi = undefined; // 必须是 undefined，绝不能是 null
      const progressKey = "progress:" + currentBookMeta;
      try {
        const stored = await chrome.storage.local.get([progressKey]);
        if (stored[progressKey]) {
          startCfi = stored[progressKey];
        }
      } catch (e) { /* 忽略 */ }

      await createRendition(readingMode, startCfi);

      // 书籍就绪后直接显示进度百分比，并加载目录
      book.ready.then(function () {
        loadTOC();
      });

    } catch (err) {
      console.error("EPUB 加载失败:", err);
      showAIRequestError(null, "文件加载失败：" + err.message);
    }
  }

  // ---------- 关闭书籍 ----------
  function closeBook() {
    clearTimeout(progressSaveTimer);
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
    activeTocHref = "";
    if (tocList) tocList.innerHTML = "";
    setTocDrawer(false);
  }

  function renderToc() {
    if (!tocList) return;
    tocList.innerHTML = "";
    if (!tocItems.length) {
      const empty = document.createElement("div");
      empty.className = "toc-empty";
      empty.textContent = "本书未提供可用目录";
      tocList.appendChild(empty);
      return;
    }
    const flat = [];
    flattenToc(tocItems, 0, flat);
    flat.forEach(function (item) {
      const el = document.createElement("div");
      el.className = "toc-item toc-depth-" + Math.min(item.depth, 4);
      el.dataset.href = item.href || "";
      el.tabIndex = 0;
      el.textContent = item.label;
      el.title = "跳转到该章节";
      const openTocItem = function () {
        if (!rendition || !item.href) return;
        rendition.display(item.href).then(function () {
          if (!isWideTocLayout()) setTocDrawer(false);
        }).catch(function (err) {
          console.error("目录跳转失败:", err);
        });
      };
      el.addEventListener("click", openTocItem);
      el.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openTocItem();
        }
      });
      tocList.appendChild(el);
    });
    activeTocHref = "";
    updateActiveToc(getCurrentLocation());
  }

  const wideTocMedia = window.matchMedia("(min-width: 1200px)");
  let renditionResizeTimer = null;

  function isWideTocLayout() {
    return wideTocMedia.matches;
  }

  function requestRenditionResize() {
    if (!rendition || !viewer) return;
    clearTimeout(renditionResizeTimer);
    renditionResizeTimer = setTimeout(function () {
      if (!rendition) return;
      const location = getCurrentLocation();
      const cfi = location && location.start && location.start.cfi;
      try {
        rendition.resize(viewer.clientWidth, viewer.clientHeight);
        if (cfi) rendition.display(cfi).catch(function (err) { console.error("阅读区重算后恢复位置失败:", err); });
      } catch (err) {
        console.error("阅读区尺寸重算失败:", err);
      }
    }, 220);
  }

  function updateTocControl() {
    const wide = isWideTocLayout();
    if (wide && app) app.classList.remove("toc-drawer-open");
    if (!btnToc) return;
    btnToc.hidden = wide;
    const open = !wide && !!(app && app.classList.contains("toc-drawer-open"));
    btnToc.setAttribute("aria-expanded", String(open));
    btnToc.setAttribute("title", open ? "关闭目录" : "打开目录");
    btnToc.setAttribute("aria-label", open ? "关闭目录" : "打开目录");
  }

  function setTocDrawer(open) {
    if (!app) return;
    app.classList.toggle("toc-drawer-open", !isWideTocLayout() && !!open);
    updateTocControl();
    requestRenditionResize();
  }

  function handleTocLayoutChange() {
    if (isWideTocLayout() && app) app.classList.remove("toc-drawer-open");
    updateTocControl();
    requestRenditionResize();
  }

  if (btnToc && tocPanel) btnToc.addEventListener("click", function () {
    setTocDrawer(!(app && app.classList.contains("toc-drawer-open")));
  });
  if (btnAiToggle) btnAiToggle.addEventListener("click", function () {
    setAiPaneCollapsed(!aiPane.classList.contains("is-collapsed"));
  });
  if (btnModeContinuous) btnModeContinuous.addEventListener("click", function () {
    switchReadingMode("continuous");
  });
  if (btnModePaginated) btnModePaginated.addEventListener("click", function () {
    switchReadingMode("paginated");
  });
  if (wideTocMedia.addEventListener) wideTocMedia.addEventListener("change", handleTocLayoutChange);
  else wideTocMedia.addListener(handleTocLayoutChange);
  window.addEventListener("resize", requestRenditionResize);
  updateTocControl();
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
    if (rendition && readingMode === "paginated") {
      rendition.prev();
    }
  }

  function nextPage() {
    if (rendition && readingMode === "paginated") {
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
    msg.dataset.state = isLoading ? "loading" : "ready";

    var meta = document.createElement("div");
    meta.className = "chat-msg-meta";
    var author = document.createElement("span");
    author.textContent = role === "user" ? "你" : "读见陪读";
    meta.appendChild(author);
    if (role === "ai") {
      var state = document.createElement("span");
      state.className = "chat-msg-state";
      state.textContent = isLoading ? "进行中" : "";
      meta.appendChild(state);
    }

    var bubble = document.createElement("div");
    bubble.className = "bubble";
    if (isLoading) bubble.classList.add("loading");
    bubble.textContent = text;

    msg.appendChild(meta);
    msg.appendChild(bubble);
    chatContainer.appendChild(msg);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    return bubble;
  }

  function markAIMessageState(bubble, state, label) {
    if (!bubble) return;
    const message = bubble.closest(".chat-msg");
    if (!message) return;
    message.dataset.state = state;
    const stateLabel = message.querySelector(".chat-msg-state");
    if (stateLabel) stateLabel.textContent = label || "";
    bubble.classList.toggle("loading", state === "loading");
  }

  function showAIRequestError(bubble, message) {
    if (!bubble) {
      const errorBubble = appendChatMessage("ai", message);
      markAIMessageState(errorBubble, "error", "需要重试");
      setWorkspaceStatus("error", "请求未完成");
      return;
    }
    bubble.classList.remove("loading");
    bubble.textContent = message;
    markAIMessageState(bubble, "error", "需要重试");
    setWorkspaceStatus("error", "请求未完成");
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
  const extractResultShell = document.getElementById("extract-result-shell");
  const extractActions = document.getElementById("extract-actions");
  const extractCancel = document.getElementById("extract-cancel");
  const extractPhaseLabel = document.getElementById("extract-phase-label");
  const extractCurrent = document.getElementById("extract-current");
  const extractCount = document.getElementById("extract-count");
  const extractProgressPercent = document.getElementById("extract-progress-percent");
  const extractFailure = document.getElementById("extract-failure");
  const extractErrorText = document.getElementById("extract-error-text");
  let extractMarkdownCache = "";
  let extractAnchors = [];
  let extractRunning = false;
  let extractTimerId = null;
  let extractStartTime = 0;

  function formatExtractTime(ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = function (n) { return String(n).padStart(2, "0"); };
    return (h > 0 ? h + ":" : "") + pad(m) + ":" + pad(s);
  }

  function setExtractTimerText(ms) {
    const el = document.getElementById("extract-timer");
    if (el) el.textContent = formatExtractTime(ms);
  }

  function startExtractTimer() {
    stopExtractTimer();
    extractStartTime = Date.now();
    setExtractTimerText(0);
    extractTimerId = setInterval(function () {
      setExtractTimerText(Date.now() - extractStartTime);
    }, 1000);
  }

  function stopExtractTimer() {
    if (extractTimerId !== null) {
      clearInterval(extractTimerId);
      extractTimerId = null;
    }
    // 结束时定格最终用时（仅在有计时记录时）
    if (extractStartTime) setExtractTimerText(Date.now() - extractStartTime);
  }

  function finishExtractRun() {
    extractRunning = false;
    stopExtractTimer();
  }

  function openExtractModal() {
    if (extractModal) extractModal.classList.add("open");
  }

  function closeExtractModal() {
    // 提取进行中不允许被动关闭：必须显式确认取消
    if (extractRunning && !confirm("提取正在进行，确定要取消吗？")) return;
    if (typeof window.cancelExtraction === "function") window.cancelExtraction();
    if (extractModal) extractModal.classList.remove("open");
    finishExtractRun();
  }

  function setExtractPhase(phase, state) {
    const order = ["parse", "map", "reduce", "done"];
    const activeIndex = order.indexOf(phase);
    document.querySelectorAll(".extract-stage").forEach(function (stage) {
      const index = order.indexOf(stage.dataset.phase);
      stage.classList.toggle("is-complete", activeIndex > -1 && index < activeIndex);
      stage.classList.toggle("is-active", stage.dataset.phase === phase && state !== "error");
      stage.classList.toggle("is-error", stage.dataset.phase === phase && state === "error");
    });
  }

  function setExtractActivity(text, isError) {
    if (!extractStatus) return;
    extractStatus.classList.toggle("is-error", !!isError);
    const activityText = extractStatus.querySelector(".extract-activity-text");
    if (activityText) activityText.textContent = text;
  }

  function setExtractBlockProgress(current, total) {
    const safeTotal = Math.max(0, Number(total) || 0);
    const safeCurrent = Math.min(safeTotal, Math.max(0, Number(current) || 0));
    const pct = safeTotal ? Math.round((safeCurrent / safeTotal) * 100) : 0;
    if (extractProgressFill) extractProgressFill.style.width = pct + "%";
    if (extractProgressPercent) extractProgressPercent.textContent = safeTotal ? pct + "%" : "等待分块";
    if (extractCount) extractCount.textContent = safeTotal ? safeCurrent + " / " + safeTotal : "—";
    const bar = extractProgressFill && extractProgressFill.parentElement;
    if (bar) bar.setAttribute("aria-valuenow", String(pct));
  }

  function showExtractFailure(message, title) {
    const failureTitle = extractFailure && extractFailure.querySelector("strong");
    if (failureTitle) failureTitle.textContent = title || "本次提取未完成";
    if (extractErrorText) extractErrorText.textContent = message || "请检查配置或网络后重试。";
    if (extractFailure) extractFailure.style.display = "flex";
    if (extractCancel) extractCancel.style.display = "none";
    if (extractProgressText) extractProgressText.textContent = title || "本次提取未完成";
    if (extractCurrent) extractCurrent.textContent = message || "可以保留已完成分块并重试";
    const active = document.querySelector(".extract-stage.is-active");
    setExtractPhase(active ? active.dataset.phase : "parse", "error");
  }

  function resetExtractUI() {
    extractMarkdownCache = "";
    extractAnchors = [];
    stopExtractTimer();
    extractStartTime = 0;
    setExtractTimerText(0);
    setExtractActivity("读取章节与段落", false);
    if (extractResult) { extractResult.style.display = "none"; extractResult.innerHTML = ""; }
    if (extractResultShell) extractResultShell.style.display = "none";
    if (extractActions) extractActions.style.display = "none";
    if (extractFailure) extractFailure.style.display = "none";
    if (extractCancel) extractCancel.style.display = "inline-block";
    if (extractProgressWrap) extractProgressWrap.style.display = "block";
    setExtractBlockProgress(0, 0);
    setExtractPhase("parse");
    if (extractPhaseLabel) extractPhaseLabel.textContent = "阶段 1 / 4 · 解析";
    if (extractProgressText) extractProgressText.textContent = "正在解析书籍结构…";
    if (extractCurrent) extractCurrent.textContent = "读取章节与段落";
  }

  function renderExtractProgress(p) {
    if (!p || !extractProgressText || !extractProgressFill) return;
    if (p.phase === "start") {
      setExtractPhase("parse");
      if (extractPhaseLabel) extractPhaseLabel.textContent = "阶段 1 / 4 · 解析";
      extractProgressText.textContent = "正在解析书籍结构…";
      if (extractCurrent) extractCurrent.textContent = p.label || "读取章节与段落";
      setExtractActivity(p.label || "读取章节与段落", false);
    } else if (p.phase === "map") {
      setExtractPhase("map");
      setExtractBlockProgress(p.current, p.total);
      if (extractPhaseLabel) extractPhaseLabel.textContent = "阶段 2 / 4 · 分块提取";
      extractProgressText.textContent = "已完成 " + p.current + " / " + p.total + " 个分块";
      if (p.status === "error") {
        const errorText = "分块失败，已记录并继续：" + p.label;
        if (extractCurrent) extractCurrent.textContent = errorText;
        setExtractActivity(errorText + (p.error ? " · " + p.error : ""), true);
      } else {
        const prefix = p.status === "done" ? "刚完成" : "正在处理";
        if (extractCurrent) extractCurrent.textContent = prefix + "：" + p.label;
        setExtractActivity(prefix + "：" + p.label, false);
      }
    } else if (p.phase === "resume") {
      setExtractPhase("map");
      setExtractBlockProgress(p.current, p.total);
      if (extractPhaseLabel) extractPhaseLabel.textContent = "阶段 2 / 4 · 分块提取";
      extractProgressText.textContent = "已恢复 " + p.current + " / " + p.total + " 个分块";
      if (extractCurrent) extractCurrent.textContent = "继续处理尚未完成的内容";
      setExtractActivity(p.label || "从本地缓存恢复进度", false);
    } else if (p.phase === "reduce") {
      setExtractPhase("reduce");
      setExtractBlockProgress(p.total, p.total);
      if (extractPhaseLabel) extractPhaseLabel.textContent = "阶段 3 / 4 · 综合框架";
      extractProgressText.textContent = "正在综合全书框架…";
      if (extractCurrent) extractCurrent.textContent = "组织章节骨架、概念关系与论证主线";
      if (extractProgressPercent) extractProgressPercent.textContent = "分块已完成";
      setExtractActivity("综合已完成分块，生成可回看的 Markdown 框架", false);
    }
  }

  function showExtractResult(markdown, fromCache) {
    markdown = typeof window.normalizeFrameworkMarkdown === "function"
      ? window.normalizeFrameworkMarkdown(markdown)
      : String(markdown || "");
    // 最后一道保险：normalize 后仍以 { 开头（整体 JSON 无法解析），用正则兜底提取
    if (String(markdown).trim().indexOf("{") === 0 && typeof window.salvageFrameworkMarkdown === "function") {
      const salvaged = window.salvageFrameworkMarkdown(markdown);
      if (salvaged) markdown = salvaged;
    }
    if (!markdown) {
      showExtractFailure("模型返回的框架内容无效，请重试或更换模型。", "框架内容无效");
      finishExtractRun();
      return;
    }
    extractMarkdownCache = markdown;
    setExtractPhase("done");
    if (extractPhaseLabel) extractPhaseLabel.textContent = "阶段 4 / 4 · 完成";
    if (extractProgressText) extractProgressText.textContent = fromCache ? "已加载本地缓存框架" : "全书框架已完成";
    if (extractCurrent) extractCurrent.textContent = fromCache ? "可直接回看、复制或重新提取" : "请回看结构与来源，再决定如何使用";
    if (extractProgressPercent) extractProgressPercent.textContent = "已完成";
    if (extractProgressFill) extractProgressFill.style.width = "100%";
    setExtractActivity("框架已就绪；来源跳转仍为实验性能力", false);
    if (extractCancel) extractCancel.style.display = "none";
    if (extractFailure) extractFailure.style.display = "none";
    if (extractResultShell) extractResultShell.style.display = "block";
    if (extractResult) {
      extractResult.style.display = "block";
      try {
        extractResult.innerHTML = typeof window.renderMarkdown === "function" ? window.renderMarkdown(markdown) : markdown;
      } catch (e) {
        console.error("结果渲染失败，降级为纯文本:", e);
        extractResult.textContent = markdown;
      }
    }
    if (extractActions) extractActions.style.display = "flex";
  }

  // 下载文件时附加 Obsidian 兼容 frontmatter
  function buildExportMarkdown() {
    const lines = [];
    lines.push("---");
    lines.push("title: 《" + currentBookMeta + "》全书框架");
    lines.push("type: " + BRAND.name + "-全书框架");
    lines.push("generated: " + new Date().toISOString().slice(0, 10));
    lines.push("---");
    lines.push("");
    // 导出去掉 aireader-cfi 内部链接（Obsidian 无法使用），保留"↩ 原文"文字标记
    lines.push(extractMarkdownCache.replace(/\[([^\]]*)\]\(aireader-cfi:[^)]*\)/g, "$1"));
    return lines.join("\n");
  }

  async function runExtraction(force) {
    if (extractRunning) return; // 防连点：已有提取进行中直接忽略
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

    // 缓存：已完成 → 直接展示；未完成 → 断点续传
    let cached = null;
    if (!force) {
      try {
        cached = await window.getExtraction(currentBookMeta);
        if (cached && cached.status === "done" && cached.result_markdown) {
          const md = typeof window.normalizeFrameworkMarkdown === "function"
            ? window.normalizeFrameworkMarkdown(cached.result_markdown)
            : cached.result_markdown;
          if (md) {
            extractAnchors = Array.isArray(cached.anchors) ? cached.anchors : [];
            if (cached.chunkCount) setExtractBlockProgress(cached.chunkCount, cached.chunkCount);
            showExtractResult(md, true);
            // 旧缓存可能是嵌套 JSON，顺手纠正，避免再次导出脏数据
            if (md !== cached.result_markdown) {
              await window.saveExtraction(Object.assign({}, cached, { result_markdown: md, updatedAt: Date.now() }));
            }
          }
          finishExtractRun();
          return;
        }
      } catch (e) { /* 缓存读取失败按新提取处理 */ }
    }

    let resume = null;
    let runningChunks = [];
    if (!force && cached && cached.status === "running" && Array.isArray(cached.chunks) && cached.chunks.length) {
      resume = cached.chunks;
      runningChunks = cached.chunks.slice();
      if (extractProgressText) extractProgressText.textContent = "正在恢复未完成的提取…";
      if (extractCurrent) extractCurrent.textContent = "已完成分块不会重复请求";
    }

    startExtractTimer();

    try {
      const outcome = await window.extractBookFramework(book, {
        bookTitle: currentBookMeta,
        apikey: config.apikey,
        endpoint: endpoint,
        model: model,
        onProgress: renderExtractProgress,
        resume: resume,
        onChunkDone: async function (idx, data) {
          // 每完成一块就落盘一次：失败/取消后下次可断点续传，不重复扣费
          runningChunks[idx] = data;
          try {
            await window.saveExtraction({
              bookName: currentBookMeta,
              status: "running",
              chunks: runningChunks,
              chunkCount: runningChunks.length,
              updatedAt: Date.now()
            });
          } catch (e) { /* 落盘失败不阻塞提取 */ }
        }
      });
      if (outcome.cancelled) {
        showExtractFailure("已完成的分块仍保存在本地，下次可继续。", "提取已取消");
        finishExtractRun();
        return;
      }
      const markdown = typeof window.normalizeFrameworkMarkdown === "function"
        ? window.normalizeFrameworkMarkdown(outcome.result && outcome.result.framework_markdown)
        : ((outcome.result && outcome.result.framework_markdown) || "");
      if (!markdown) throw new Error("模型未返回有效的框架内容");
      extractAnchors = Array.isArray(outcome.anchors) ? outcome.anchors : [];
      await window.saveExtraction({
        bookName: currentBookMeta,
        status: "done",
        book_summary: outcome.result.book_summary || "",
        result_markdown: markdown,
        anchors: extractAnchors,
        chunkCount: outcome.chunkCount,
        updatedAt: Date.now()
      });
      showExtractResult(markdown, false);
      finishExtractRun();
    } catch (e) {
      console.error("全书提取失败:", e && e.name, e && e.message, e);
      // 用户取消/请求中止：显示"已取消"，不当作失败
      const isAbort = !!(e && (e.name === "AbortError" ||
        (typeof DOMException !== "undefined" && e instanceof DOMException) ||
        /aborted|The user aborted/i.test(String(e.message || ""))));
      if (extractProgressText) {
        const message = (e && e.message) || (e && e.name) || "未知错误";
        showExtractFailure(
          isAbort ? "已完成的分块仍保存在本地，下次可继续。" : message,
          isAbort ? "提取已取消" : "本次提取未完成"
        );
      }
      finishExtractRun();
    }
  }

  function copyExtractMarkdown() {
    if (!extractMarkdownCache) return;
    navigator.clipboard.writeText(extractMarkdownCache).then(function () {
      const btn = document.getElementById("extract-copy");
      if (btn) {
        btn.textContent = "已复制";
        setTimeout(function () { btn.textContent = "复制 Markdown"; }, 2000);
      }
    }).catch(function () { alert("复制失败，请手动选择文本复制。"); });
  }

  function downloadExtractMarkdown() {
    if (!extractMarkdownCache) return;
    const blob = new Blob(["\uFEFF" + buildExportMarkdown()], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (currentBookMeta || BRAND.name) + "-全书框架.md";
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
    let responseBubble = null;
    let requestAddedToHistory = false;
    try {
      // 1. 获取配置
      let result;
      try {
        result = await chrome.storage.local.get(["apikey", "endpoint", "model"]);
      } catch (e) {
        throw new Error("无法读取 AI 配置");
      }
      if (!result.apikey) {
        showAIRequestError(null, "请先在配置中心设置 API Key，再重试陪读。");
        return;
      }
      const endpoint = normalizeEndpoint(result.endpoint);

      // 2. 提取上下文（调用 Skill 对应的提取方法）
      responseBubble = appendChatMessage("ai", "正在读取“" + skill.name + "”所需的上下文…", true);
      let contextResult;
      try {
        contextResult = await skill.getContext(rendition, book);
      } catch (e) {
        console.error("陪读上下文提取失败:", e);
        showAIRequestError(responseBubble, "无法获取阅读上下文。请重新打开当前书籍后重试。");
        return;
      }
      if (contextResult.error || !contextResult.text || contextResult.text.length < 10) {
        showAIRequestError(responseBubble, contextResult.error || "提取到的文本过短，无法分析。请翻到正文后重试。");
        return;
      }

      // 3. 构建 Prompt 并推入历史
      const userPrompt = skill.buildPrompt(contextResult.text);
      const finalPrompt = userPrompt + (currentLang === "en" ? "\n\n(Please output your entire response in English.)" : "");
      pushHistory({ role: "user", content: finalPrompt });
      requestAddedToHistory = true;
      appendChatMessage("user", "使用陪读动作：“" + skill.name + "”");

      // 4. 复用同一个状态气泡发起流式请求，避免上下文与思考状态重复堆叠
      responseBubble.textContent = "上下文已就绪，正在组织回答…";
      markAIMessageState(responseBubble, "loading", "正在回答");
      const finalContent = await streamAIResponse(
        chatHistory,
        result.model || "deepseek-v4-flash",
        endpoint,
        result.apikey,
        responseBubble,
        { maxTokens: SKILL_MAX_TOKENS[actionKey] || 3000, timeoutMs: 90000 }
      );

      if (!finalContent) {
        chatHistory.pop();
        requestAddedToHistory = false;
        markAIMessageState(responseBubble, "error", "需要重试");
        setWorkspaceStatus("error", "请求未完成");
        return;
      }
      pushHistory({ role: "assistant", content: finalContent });
      requestAddedToHistory = false;
      markAIMessageState(responseBubble, "success", "陪读完成");
      setWorkspaceStatus("success", "回答已完成");
      addStarButtonToBubble(responseBubble, finalContent);
      if (actionKey === "quiz") setQuizLock(true);
    } catch (e) {
      console.error("陪读请求处理失败:", e);
      if (requestAddedToHistory) chatHistory.pop();
      if (!responseBubble || responseBubble.classList.contains("loading")) {
        showAIRequestError(responseBubble, "陪读请求未能完成。请检查 Endpoint、模型和网络后重试。");
      }
    } finally {
      setBusy(false);
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
      const guidance = appendChatMessage("ai", "这段推演还不足 30 字。请先写下完整的判断依据，再继续陪读。");
      markAIMessageState(guidance, "error", "等待你的推演");
      setWorkspaceStatus("error", "等待完整推演");
      inputEl.focus();
      return;
    }

    setBusy(true);
    let responseBubble = null;
    let requestAddedToHistory = false;
    try {
      let result;
      try {
        result = await chrome.storage.local.get(["apikey", "endpoint", "model"]);
      } catch (e) {
        throw new Error("无法读取 AI 配置");
      }
      if (!result.apikey) {
        showAIRequestError(null, "请先在配置中心设置 API Key，再发送问题。");
        return;
      }

      inputEl.value = "";
      appendChatMessage("user", text);
      if (isQuizLocked) setQuizLock(false);

      // 自由提问自动携带当前页上下文，让 AI 真正"读到"你在读的内容
      const visibleText = getVisibleText().substring(0, 2000);
      let userContent = text;
      if (visibleText) {
        userContent = "【当前页上下文（来自你正在阅读的书籍，仅供 AI 参考；回答请以用户问题为准）】\n" + visibleText + "\n\n【用户问题】\n" + text;
      }
      userContent += (currentLang === "en" ? "\n\n(Please output your entire response in English.)" : "");
      pushHistory({ role: "user", content: userContent });
      requestAddedToHistory = true;

      responseBubble = appendChatMessage("ai", "正在结合当前页内容组织回答…", true);
      const finalContent = await streamAIResponse(
        chatHistory,
        result.model || "deepseek-v4-flash",
        normalizeEndpoint(result.endpoint),
        result.apikey,
        responseBubble,
        { timeoutMs: 90000 }
      );
      if (!finalContent) {
        chatHistory.pop();
        requestAddedToHistory = false;
        markAIMessageState(responseBubble, "error", "需要重试");
        setWorkspaceStatus("error", "请求未完成");
        return;
      }
      pushHistory({ role: "assistant", content: finalContent });
      requestAddedToHistory = false;
      markAIMessageState(responseBubble, "success", "陪读完成");
      setWorkspaceStatus("success", "回答已完成");
      addStarButtonToBubble(responseBubble, finalContent);
    } catch (e) {
      console.error("自由提问处理失败:", e);
      if (requestAddedToHistory) chatHistory.pop();
      if (!responseBubble || responseBubble.classList.contains("loading")) {
        showAIRequestError(responseBubble, "提问未能完成。请检查 Endpoint、模型和网络后重试。");
      }
    } finally {
      setBusy(false);
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
    if (!rendition || readingMode !== "paginated") return;
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
      if (extractProgressText) extractProgressText.textContent = "正在取消提取…";
      if (extractCurrent) extractCurrent.textContent = "已完成分块将保留在本地";
      setExtractActivity("等待当前请求安全停止", false);
    });
  }
  const extractCopyBtn = document.getElementById("extract-copy");
  if (extractCopyBtn) extractCopyBtn.addEventListener("click", copyExtractMarkdown);
  const extractDownloadBtn = document.getElementById("extract-download");
  if (extractDownloadBtn) extractDownloadBtn.addEventListener("click", downloadExtractMarkdown);
  const extractAgainBtn = document.getElementById("extract-again");
  if (extractAgainBtn) extractAgainBtn.addEventListener("click", function () { runExtraction(true); });
  const extractRetryBtn = document.getElementById("extract-retry");
  if (extractRetryBtn) extractRetryBtn.addEventListener("click", function () { runExtraction(false); });
  // 溯源跳转：点击骨架中的"↩ 原文"回到书籍对应章节
  if (extractResult) {
    extractResult.addEventListener("click", function (e) {
      try {
      const link = e.target && e.target.closest ? e.target.closest('a[href^="aireader-cfi:"]') : null;
      if (!link) return;
      e.preventDefault();
      const idx = parseInt(link.getAttribute("href").slice("aireader-cfi:".length), 10);
      const anchor = extractAnchors[idx];
      if (anchor && rendition) {
        // 解析跳转目标 href：优先用锚点保存的，缺失时按 spine 索引从 book 取
        let targetHref = anchor.href || null;
        if (!targetHref && anchor.spine !== undefined && book && book.spine && book.spine.spineItems) {
          const item = book.spine.spineItems[anchor.spine];
          if (item && item.href) targetHref = item.href;
        }
        // 在已渲染章节文档中按段落文本定位，用 epub.js 自己的 cfiFromRange 生成 CFI
        const locateInContents = function (startText) {
          try {
            const contentsList = rendition.getContents();
            if (!contentsList || !contentsList.length) return false;
            const target = String(startText || "").replace(/\s+/g, "");
            if (!target) return false;
            for (const contents of contentsList) {
              const doc = contents.document;
              if (!doc || !doc.body) continue;
              const paras = Array.prototype.slice.call(doc.body.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, blockquote, pre"));
              for (const el of paras) {
                const t = String(el.textContent || "").replace(/\s+/g, "");
                if (t && t.indexOf(target) === 0) {
                  console.info("[溯源跳转] 命中段落:", el.tagName, String(el.textContent || "").slice(0, 16));
                  const range = doc.createRange();
                  range.setStart(el, 0);
                  range.collapse(true);
                  if (contents.cfiFromRange) {
                    const cfi = contents.cfiFromRange(range);
                    console.info("[溯源跳转] 生成 CFI:", cfi);
                    const beforeCfi = rendition.currentLocation() && rendition.currentLocation().start && rendition.currentLocation().start.cfi;
                    rendition.display(cfi).then(function () {
                      console.info("[溯源跳转] CFI 翻页完成");
                      setTimeout(function () {
                        try {
                          const after = rendition.currentLocation() && rendition.currentLocation().start;
                          console.info("[溯源跳转] 翻页后位置:", after && after.cfi, "| 变化:", beforeCfi !== (after && after.cfi));
                        } catch (e2) { console.error("[溯源跳转] 位置读取失败:", e2); }
                      }, 600);
                    }).catch(function (err) {
                      console.error("[溯源跳转] CFI 翻页失败:", err && err.message, err);
                    });
                  }
                  return true;
                }
              }
            }
          } catch (err) {
            console.error("定位原文失败:", err);
          }
          return false;
        };

        if (anchor.startText && targetHref) {
          console.info("[溯源跳转] 章节加载:", targetHref);
          // 先加载章节，再在渲染后的文档中定位段落
          rendition.display(targetHref).then(function () {
            const found = locateInContents(anchor.startText);
            console.info("[溯源跳转] 段落定位:", found ? "成功" : "未找到，停留在章节", anchor.label);
          }).catch(function (err) {
            console.error("[溯源跳转] 章节加载失败:", err);
          });
        } else if (targetHref) {
          console.info("[溯源跳转] 章节跳转:", targetHref);
          rendition.display(targetHref).catch(function (err) {
            console.error("[溯源跳转] 章节跳转失败:", err);
          });
        } else if (anchor.cfi) {
          // 旧缓存兼容：只有 CFI 没有 startText 时使用
          rendition.display(anchor.cfi).catch(function (err) {
            console.error("CFI 跳转失败，回退到章节:", err);
            if (targetHref) {
              rendition.display(targetHref).catch(function (e2) {
                console.error("章节回退失败:", e2);
              });
            }
          });
        } else {
          console.warn("[溯源跳转] 锚点无效：", anchor);
          return;
        }
        closeExtractModal();
      }
    } catch (err) {
      console.error("[溯源跳转] 处理异常:", err);
    }
    });
  }
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
