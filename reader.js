/* ============================================
   AIReader - 核心阅读引擎 v2.0
   Vanilla JS · 零依赖 · 高内聚
   新增: LocalForage 持久化 · 断点续传 · DOM 文本提取
   ============================================ */

(function () {
  "use strict";

  // ---------- 工具函数: 智能补全 Endpoint ----------
  function normalizeEndpoint(raw) {
    if (!raw) return "https://api.deepseek.com/chat/completions";
    if (raw.endsWith("/chat/completions")) return raw;
    return raw.replace(/\/+$/, "") + "/chat/completions";
  }

  // ---------- DOM 引用 ----------
  const dropZone = document.getElementById("drop-zone");
  const fileInput = document.getElementById("file-input");
  const viewerContainer = document.getElementById("viewer-container");
  const viewer = document.getElementById("viewer");
  const bookTitle = document.getElementById("book-title");
  const pageIndicator = document.getElementById("page-indicator");
  const btnClose = document.getElementById("btn-close");
  const btnTheme = document.getElementById("btn-theme");
  const btnPrev = document.getElementById("btn-prev");
  const btnNext = document.getElementById("btn-next");
  const aiOutput = document.getElementById("ai-output");


  // ---------- 原生微型数据库引擎 ----------
  const DB_NAME = "AIReaderDB";
  const STORE_NAME = "books";

  function getDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = (e) => {
        e.target.result.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function saveBookToDB(bookData) {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(bookData, "cachedBook");
    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = reject;
    });
  }

  async function loadBookFromDB() {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get("cachedBook");
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = reject;
    });
  }

  async function clearBookFromDB() {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete("cachedBook");
  }



  // ---------- 主题状态 ----------
  let currentTheme = localStorage.getItem("aireader-theme") || "light";
  document.documentElement.setAttribute("data-theme", currentTheme);

  // ---------- 阅读器状态 ----------
  let book = null;
  let rendition = null;
  let currentBookMeta = null;

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
      showViewer(true);

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
      appendAIResponse(`❌ 文件加载失败: ${err.message}`);
    }
  }

  // ---------- 关闭书籍 ----------
  function closeBook() {
    if (rendition) { rendition.destroy(); rendition = null; }
    book = null; currentBookMeta = null;
    bookTitle.textContent = "未命名书籍";
    pageIndicator.textContent = "—";
    viewer.innerHTML = ""; showViewer(false); fileInput.value = "";

    clearBookFromDB().catch(function () {});
    
  }
    // ---------- 初始化: 自动恢复上次阅读 ----------
  loadBookFromDB().then(function (bookData) {
    if (bookData && bookData.data) {
      loadEpub(bookData);
    }
  }).catch(function (e) {
    console.error("恢复缓存书籍失败:", e);
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

  // ---------- AI 面板输出 ----------
  function appendAIResponse(text, isLoading) {
    const block = document.createElement("div");
    block.className = "response-block";
    if (isLoading) block.classList.add("loading");
    block.textContent = text;

    // 移除 placeholder
    var placeholder = aiOutput.querySelector(".ai-placeholder");
    if (placeholder) placeholder.remove();

    aiOutput.appendChild(block);
    aiOutput.scrollTop = aiOutput.scrollHeight;
    return block;
  }

  // ---------- AI 动作处理 ----------
  async function handleAIAction(action) {
    var result;
    try {
      result = await chrome.storage.local.get(["apikey", "endpoint", "model"]);
    } catch (e) {
      appendAIResponse("⚠️ 无法读取配置，请先在扩展选项中设置 API Key。");
      return;
    }

    var apikey = result.apikey;
    var endpoint = normalizeEndpoint(result.endpoint);
    var model = result.model || "deepseek-chat";

    if (!apikey) {
      appendAIResponse("⚠️ 请先在扩展选项页配置 API Key。");
      return;
    }

    // 所见即所得: 直接从已渲染的 iframe DOM 提取文本
    var contextText = "";
    if (rendition) {
      try {
        var contents = rendition.getContents();
        if (contents && contents.length > 0) {
          contextText = (contents[0].document.body.textContent || contents[0].document.body.innerText || "").trim();
        }
      } catch (e) {
        contextText = "";
      }
    }

    if (!contextText || contextText.length < 10) {
      appendAIResponse("⚠️ 警告：当前页面文本提取失败或文本过短，请尝试翻页后重试。");
      return;
    }

    var actionPrompts = {
      outline: "请基于以下文本，用中文提炼出本章的结构骨架（包括核心论点、分论点和关键论据），以简洁的层级列表呈现：\n\n" + contextText,
      quiz: "请基于以下文本，生成 3 个有深度的反问式思考题，帮助读者检验是否真正理解了内容的核心逻辑。每个问题后附简短的标准答案。\n\n" + contextText,
      explain: "请用通俗易懂的中文解释以下段落的含义，如有专业术语请一并说明：\n\n" + contextText,
      custom: "请分析以下文本的核心思想：\n\n" + contextText
    };

    var prompt = actionPrompts[action] || actionPrompts.custom;
    var loadingBlock = appendAIResponse("思考中...", true);

    try {
      var resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + apikey
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: "system", content: "你是一个深度阅读认知伴侣，帮助用户真正理解文本的内涵。用中文回答，风格简洁、有洞见。" },
            { role: "user", content: prompt }
          ],
          temperature: 0.7,
          max_tokens: 2048,
          stream: false
        })
      });

      if (!resp.ok) {
        var errText = await resp.text();
        throw new Error("API 错误 (" + resp.status + "): " + errText);
      }

      var data = await resp.json();
      var reply = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "（API 返回为空）";

      loadingBlock.classList.remove("loading");
      loadingBlock.textContent = reply;
    } catch (e) {
      loadingBlock.classList.remove("loading");
      loadingBlock.textContent = "❌ 请求失败: " + e.message;
    }
  }

  // ---------- 文件导入统一入口 ----------
  function importFile(file) {
    if (!file || !file.name.toLowerCase().endsWith(".epub")) {
      alert("⚠️ 请导入 .epub 格式的电子书文件！");
      return;
    }
    // 读取为二进制流，彻底摆脱文件系统的生命周期权限束缚
    const reader = new FileReader();
    reader.onload = async function(e) {
      const arrayBuffer = e.target.result;
      const bookData = { name: file.name, data: arrayBuffer };
      
      try { await saveBookToDB(bookData); } 
      catch (err) { console.error("存档失败:", err); }
      
      loadEpub(bookData);
    };
    reader.readAsArrayBuffer(file);
  }

  // ---------- 事件绑定 ----------

  // 文件选择
  dropZone.addEventListener("click", function () { fileInput.click(); });
  fileInput.addEventListener("change", function (e) {
    var file = e.target.files[0];
    importFile(file);
  });

  // 拖拽支持
  dropZone.addEventListener("dragover", function (e) {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  });
  dropZone.addEventListener("dragleave", function () {
    dropZone.classList.remove("drag-over");
  });
  dropZone.addEventListener("drop", function (e) {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    var file = e.dataTransfer.files[0];
    importFile(file);
  });

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

  // 当前 AI 输出区为空时重置 placeholder
  var aiOutputObserver = new MutationObserver(function () {
    var children = Array.from(aiOutput.children).filter(function (c) {
      return !c.classList.contains("ai-placeholder");
    });
    if (children.length === 0) {
      aiOutput.innerHTML = '\
        <div class="ai-placeholder">\
          <svg class="ai-placeholder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">\
            <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>\
          </svg>\
          <p>AI 输出将在此显示</p>\
          <p class="ai-placeholder-hint">选中文本或点击上方按钮开始</p>\
        </div>';
    }
  });
  aiOutputObserver.observe(aiOutput, { childList: true });

 

})();