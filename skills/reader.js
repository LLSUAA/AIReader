/* ============================================
   AIReader - 核心阅读引擎 v2.0
   Vanilla JS · 零依赖 · 高内聚
   新增: LocalForage 持久化 · 断点续传 · DOM 文本提取
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
    dropZone.style.display = show ? "none" : "flex";
    viewerContainer.style.display = show ? "flex" : "none";
  }

  function setQuizLock(locked) {
    isQuizLocked = locked;
    document.querySelectorAll(".ai-btn").forEach(btn => {
      btn.disabled = locked;
    });
    const inputEl = document.getElementById("chat-input");
    if (inputEl) {
      if (locked) {
        inputEl.placeholder = "🔒 试炼进行中，必须输入你的推演答案才能解锁...";
        inputEl.focus();
      } else {
        inputEl.placeholder = "输入你的推演或向导师提问...";
      }
    }
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
    if (!rendition) return;
    const location = rendition.currentLocation();
    if (location && location.start) {
      // 1. 持久化当前阅读位置（按书名存储，实现多书记忆）
      if (currentBookMeta) {
        const saveObj = {};
        saveObj[currentBookMeta] = location.start.cfi;
        chrome.storage.local.set(saveObj);
      }
      
      // 2. 全局页码计算与显示
      if (book.locations && book.locations.length > 0) {
        const percentage = book.locations.percentageFromCfi(location.start.cfi);
        const total = book.locations.total;
        const current = Math.floor(percentage * total) + 1;
        pageIndicator.textContent = `${current} / ${total}`;
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

      // 注册 epub.js 内部主题
      rendition.themes.register("light", {
        "body": { "background": "transparent", "color": "#1A1D20 !important" },
        "p, div, span, h1, h2, h3, h4": { "color": "#1A1D20 !important" }
      });
      rendition.themes.register("dark", {
        "body": { "background": "transparent", "color": "#c9d1d9 !important" },
        "p, div, span, h1, h2, h3, h4": { "color": "#c9d1d9 !important" }
      });

      // 注册位置变化回调
      rendition.on("relocated", updatePageIndicator);

      // 应用主题
      applyEpubTheme();

      // 读取上次阅读位置，实现断点续传
      // 读取上次阅读位置（按书名隔离，防止 CFI 串位）
      let startCfi = undefined; // 必须是 undefined，绝不能是 null
      try {
        const stored = await chrome.storage.local.get([currentBookMeta]);
        if (stored[currentBookMeta]) {
          startCfi = stored[currentBookMeta];
        }
      } catch (e) { /* 忽略 */ }

      await rendition.display(startCfi);

      // 异步生成全局页码索引（带超时降级保护）
      pageIndicator.textContent = "正在扫描全书...";
      book.ready.then(function () {
        // 增加字符跨度到 2000 以提升大文件的计算速度
        const generatePromise = book.locations.generate(2000);
        // 强制 8 秒超时保护
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("计算超时")), 8000));
        
        return Promise.race([generatePromise, timeoutPromise]);
      }).then(function () {
        updatePageIndicator();
      }).catch(function (err) {
        console.warn("分页计算中止 (文件过大):", err);
        // 降级为章节内进度显示
        pageIndicator.textContent = "●"; 
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
    viewer.innerHTML = ""; showViewer(false); fileInput.value = "";
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

  // ---------- 动作调度器（SKILLS 策略驱动） ----------
  async function handleAIAction(actionKey) {
    const skill = SKILLS[actionKey];
    if (!skill) return;

    // 1. 获取配置
    let result;
    try { result = await chrome.storage.local.get(["apikey", "endpoint", "model"]); } catch (e) { return; }
    if (!result.apikey) { appendChatMessage("ai", "⚠️ 请先在扩展选项页配置 API Key。"); return; }
    const endpoint = normalizeEndpoint(result.endpoint);

    // 2. 提取上下文（调用 Skill 对应的提取方法）
    const bubble = appendChatMessage("ai", "正在执行 [" + skill.name + "]，扫描上下文中...", true);
    const contextResult = await skill.getContext(rendition, book);

    if (contextResult.error || !contextResult.text || contextResult.text.length < 10) {
      bubble.classList.remove("loading");
      bubble.textContent = contextResult.error || "⚠️ 提取到的文本过短，无法分析。";
      return;
    }

    // 3. 构建 Prompt 并推入历史
    const userPrompt = skill.buildPrompt(contextResult.text);
    const finalPrompt = userPrompt + (currentLang === "en" ? "\n\n(Please output your entire response in English.)" : "");
    chatHistory.push({ role: "user", content: finalPrompt });

    // UI 显示用户发起了该动作 (修改点：必须先上屏 User 气泡)
    appendChatMessage("user", "执行: " + skill.name);

    // 4. 发起流式请求 (修改点：后上屏 AI 气泡)
    const responseBubble = appendChatMessage("ai", "思考中...", true);
    const finalContent = await streamAIResponse(chatHistory, result.model || "deepseek-chat", endpoint, result.apikey, responseBubble);

    if (finalContent) {
      chatHistory.push({ role: "assistant", content: finalContent });
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

    inputEl.value = "";
    appendChatMessage("user", text);
    const finalText = text + (currentLang === "en" ? "\n\n(Please output your entire response in English.)" : "");
    chatHistory.push({ role: "user", content: finalText });

    if (isQuizLocked) {
      setQuizLock(false);
    }

    let result;
    try { result = await chrome.storage.local.get(["apikey", "endpoint", "model"]); } catch (e) { return; }
    const endpoint = normalizeEndpoint(result.endpoint);

    const bubble = appendChatMessage("ai", "导师批阅中...", true);
    const finalContent = await streamAIResponse(chatHistory, result.model || "deepseek-chat", endpoint, result.apikey, bubble);

    if (finalContent) {
      chatHistory.push({ role: "assistant", content: finalContent });
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