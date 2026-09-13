(function () {
  "use strict";

  // 书架与阅读器共享主题偏好，保持工作台在不同页面间的视觉连续性
  let currentTheme = localStorage.getItem("aireader-theme") || "light";
  document.documentElement.setAttribute("data-theme", currentTheme);

  const themeToggle = document.getElementById("library-theme");
  if (themeToggle) {
    themeToggle.addEventListener("click", function () {
      currentTheme = currentTheme === "light" ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", currentTheme);
      localStorage.setItem("aireader-theme", currentTheme);
    });
  }

  // XML/HTML 转义：书名与正文进入 EPUB 结构前必须转义，防止生成非法 OPF/NCX/HTML
  function escapeXml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeHtml(str) {
    return escapeXml(str).replace(/'/g, "&#39;");
  }

  function assertDecodedText(text) {
    if (!text || !text.trim()) throw new Error("TXT 文件没有可读取的正文。");
    if (text.includes("\uFFFD")) throw new Error("文本中出现替换字符，无法可靠识别编码。");
    const sample = text.slice(0, 20000);
    const nulCount = (sample.match(/\u0000/g) || []).length;
    const controlCount = (sample.match(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length;
    if (nulCount > 0 || controlCount / Math.max(1, sample.length) > 0.005) {
      throw new Error("文本包含异常控制字符，无法可靠识别编码。");
    }
    return text;
  }

  function decodeWith(bytes, encoding, label, offset) {
    const decoded = new TextDecoder(encoding, { fatal: true }).decode(bytes.subarray(offset || 0));
    return { text: assertDecodedText(decoded.replace(/^\uFEFF/, "")), encoding: label };
  }

  // 明确的探测顺序：BOM → 严格 UTF-8 → GB18030（兼容 GBK / GB2312）。
  function decodeTxt(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const hasUtf8Bom = bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;
    const hasUtf16LeBom = bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE;
    const hasUtf16BeBom = bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF;
    if (hasUtf8Bom || hasUtf16LeBom || hasUtf16BeBom) {
      try {
        if (hasUtf8Bom) return decodeWith(bytes, "utf-8", "UTF-8（BOM）", 3);
        if (hasUtf16LeBom) return decodeWith(bytes, "utf-16le", "UTF-16 LE（BOM）", 2);
        return decodeWith(bytes, "utf-16be", "UTF-16 BE（BOM）", 2);
      } catch (bomError) {
        throw new Error("TXT 带有编码标记，但正文无法按该编码可靠解码。文件可能已损坏。");
      }
    }
    try {
      return decodeWith(bytes, "utf-8", "UTF-8", 0);
    } catch (utfError) {
      try {
        return decodeWith(bytes, "gb18030", "GB18030（兼容 GBK / GB2312）", 0);
      } catch (gbError) {
        throw new Error("无法可靠识别 TXT 编码。请确认文件为 UTF-8、带 BOM 的 UTF-16，或 GBK / GB2312 / GB18030。");
      }
    }
  }

  function normalizeTxt(text) {
    return String(text || "")
      .replace(/^\uFEFF/, "")
      .replace(/\r\n?/g, "\n")
      .replace(/\u00A0/g, " ")
      .replace(/[\u200B\u200C\u200D\u2060]/g, "")
      .replace(/[ \t]+$/gm, "")
      .replace(/\n{4,}/g, "\n\n\n")
      .trim();
  }

  function isChapterHeading(lines, index) {
    const text = String(lines[index] || "").trim();
    if (!text || text.length > 64) return false;
    const explicit = /^(?:第\s*[〇零一二三四五六七八九十百千万两\d]+\s*[章节卷篇部集回]|序(?:章|言)?|前言|引言|导言|楔子|后记|跋|附录(?:\s*[〇零一二三四五六七八九十\d]+)?)(?:[\s　:：·、.．—-]+.*|$)$/u;
    if (explicit.test(text)) return true;
    const numeric = /^(?:[一二三四五六七八九十百]+[、.．]|\d{1,3}(?:\.\d{1,2}){0,3}(?:[、.．)）]|\s+))\s*\S+/u;
    if (!numeric.test(text)) return false;
    const beforeBlank = index === 0 || !String(lines[index - 1] || "").trim();
    const afterBlank = index === lines.length - 1 || !String(lines[index + 1] || "").trim();
    return beforeBlank || afterBlank;
  }

  function splitTxtChapters(text) {
    const lines = normalizeTxt(text).split("\n");
    const headingIndexes = [];
    lines.forEach(function (line, index) {
      if (isChapterHeading(lines, index)) headingIndexes.push(index);
    });
    if (!headingIndexes.length) {
      return { detected: false, chapters: [{ title: "正文", prefix: [], lines: lines }] };
    }
    const chapters = headingIndexes.map(function (headingIndex, index) {
      const nextIndex = headingIndexes[index + 1] === undefined ? lines.length : headingIndexes[index + 1];
      return {
        title: lines[headingIndex].trim(),
        prefix: index === 0 ? lines.slice(0, headingIndex) : [],
        lines: lines.slice(headingIndex + 1, nextIndex)
      };
    });
    return { detected: true, chapters: chapters };
  }

  function isListLine(line) {
    return /^\s*(?:[-*•·]|\d+[.、)]|[（(]?[一二三四五六七八九十]+[、)）])\s*\S+/u.test(line);
  }

  function stripListMarker(line) {
    return line.replace(/^\s*(?:[-*•·]|\d+[.、)]|[（(]?[一二三四五六七八九十]+[、)）])\s*/u, "").trim();
  }

  function mergeProseLines(lines) {
    return lines.reduce(function (result, line) {
      const current = line.trim();
      if (!current) return result;
      if (!result) return current;
      if (/[A-Za-z0-9,;:]$/.test(result) && /^[A-Za-z0-9]/.test(current)) return result + " " + current;
      return result + current;
    }, "");
  }

  function renderTextGroup(group) {
    const nonEmpty = group.filter(function (line) { return line.trim(); });
    if (!nonEmpty.length) return "";
    const allIndented = nonEmpty.every(function (line) { return /^(?:\t| {4,})/.test(line); });
    const joined = nonEmpty.join("");
    const asciiRatio = (joined.match(/[\x20-\x7E]/g) || []).length / Math.max(1, joined.length);
    const codeSignal = nonEmpty.some(function (line) {
      return /[{};=<>]|^\s*(?:function|class|const|let|var|def|if|for|while|return|import)\b/.test(line);
    });
    if (allIndented && (codeSignal || (nonEmpty.length >= 3 && asciiRatio > 0.72))) {
      return "<pre>" + escapeHtml(nonEmpty.map(function (line) { return line.replace(/^\t|^ {4}/, ""); }).join("\n")) + "</pre>";
    }
    if (nonEmpty.length >= 2 && nonEmpty.every(isListLine)) {
      return "<ul>" + nonEmpty.map(function (line) { return "<li>" + escapeHtml(stripListMarker(line)) + "</li>"; }).join("") + "</ul>";
    }
    const averageLength = nonEmpty.reduce(function (sum, line) { return sum + line.trim().length; }, 0) / nonEmpty.length;
    const verseLike = nonEmpty.length >= 3 && averageLength <= 26 && nonEmpty.filter(function (line) {
      return !/[。！？；.!?;：:]$/.test(line.trim());
    }).length >= Math.ceil(nonEmpty.length * 0.6);
    if (verseLike) {
      return '<div class="verse">' + nonEmpty.map(function (line) { return escapeHtml(line.trim()); }).join("<br />") + "</div>";
    }
    const paragraphs = [];
    let buffer = [];
    nonEmpty.forEach(function (line) {
      const startsParagraph = /^(?:　{2}| {2,})\S/.test(line);
      if (startsParagraph && buffer.length) {
        paragraphs.push(buffer);
        buffer = [];
      }
      buffer.push(line);
    });
    if (buffer.length) paragraphs.push(buffer);
    return paragraphs.map(function (lines) {
      return "<p>" + escapeHtml(mergeProseLines(lines)) + "</p>";
    }).join("");
  }

  function renderTxtLines(lines) {
    const groups = [];
    let group = [];
    lines.forEach(function (line) {
      if (!line.trim()) {
        if (group.length) groups.push(group);
        group = [];
      } else {
        group.push(line);
      }
    });
    if (group.length) groups.push(group);
    return groups.map(renderTextGroup).join("\n");
  }

  function buildChapterXhtml(chapter, detected, title) {
    const prefixHtml = renderTxtLines(chapter.prefix || []);
    const headingHtml = detected ? "<h1>" + escapeHtml(chapter.title) + "</h1>" : "";
    const bodyHtml = renderTxtLines(chapter.lines || []);
    return `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd"><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${escapeHtml(chapter.title || title)}</title><link rel="stylesheet" type="text/css" href="styles.css" /></head><body>${prefixHtml}${headingHtml}${bodyHtml}</body></html>`;
  }

  // TXT 在内存中转换为多章节 EPUB；未识别章节时只生成一个名为“正文”的 spine 项。
  async function txtToEpubArrayBuffer(txtContent, title) {
    const parsed = splitTxtChapters(txtContent);
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
    zip.file("META-INF/container.xml", `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
    const safeTitleXml = escapeXml(title);
    const manifestItems = parsed.chapters.map(function (chapter, index) {
      return `<item id="chapter-${index + 1}" href="chapter-${index + 1}.xhtml" media-type="application/xhtml+xml"/>`;
    }).join("");
    const spineItems = parsed.chapters.map(function (chapter, index) {
      return `<itemref idref="chapter-${index + 1}"/>`;
    }).join("");
    const opf = `<?xml version="1.0" encoding="UTF-8"?><package version="2.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="BookId">dujian-txt-${Date.now()}</dc:identifier><dc:title>${safeTitleXml}</dc:title><dc:language>zh-CN</dc:language></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="styles" href="styles.css" media-type="text/css"/>${manifestItems}</manifest><spine toc="ncx">${spineItems}</spine></package>`;
    zip.file("OEBPS/content.opf", opf);
    const navPoints = parsed.chapters.map(function (chapter, index) {
      return `<navPoint id="navPoint-${index + 1}" playOrder="${index + 1}"><navLabel><text>${escapeXml(chapter.title)}</text></navLabel><content src="chapter-${index + 1}.xhtml"/></navPoint>`;
    }).join("");
    zip.file("OEBPS/toc.ncx", `<?xml version="1.0" encoding="UTF-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="BookId"/></head><docTitle><text>${safeTitleXml}</text></docTitle><navMap>${navPoints}</navMap></ncx>`);
    zip.file("OEBPS/styles.css", `body{font-family:serif;font-size:1em;line-height:1.8;color:inherit}h1{font-size:1.65em;line-height:1.35;margin:1.5em 0 1em}p{margin:.85em 0;text-align:justify;text-indent:2em}ul{margin:1em 0;padding-left:1.8em}li{margin:.35em 0}.verse{margin:1.4em 0;line-height:2;white-space:normal}pre{margin:1.2em 0;padding:1em;white-space:pre-wrap;overflow-wrap:anywhere;font-family:monospace;font-size:.9em}`);
    parsed.chapters.forEach(function (chapter, index) {
      zip.file("OEBPS/chapter-" + (index + 1) + ".xhtml", buildChapterXhtml(chapter, parsed.detected, title));
    });
    const data = await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
    return { data: data, chapterCount: parsed.chapters.length, detected: parsed.detected };
  }

  // 导航切换
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (item.getAttribute('target') === "_blank") return;
      e.preventDefault();
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));
      
      item.classList.add('active');
      document.getElementById(item.dataset.target).classList.add('active');
      
      if (item.dataset.target === 'view-books') renderBooks();
      if (item.dataset.target === 'view-arsenal') renderPrinciples();
    });
  });

  let importStatusTimer = null;

  function showImportStatus(message, state) {
    const status = document.getElementById("import-status");
    if (!status) return;
    clearTimeout(importStatusTimer);
    status.textContent = message;
    status.dataset.state = state || "working";
    status.classList.add("visible");
    if (state !== "working") {
      importStatusTimer = setTimeout(function () { status.classList.remove("visible"); }, 12000);
    }
  }

  function makeUniqueBookName(preferredName, existingNames, format) {
    if (!existingNames.has(preferredName)) return preferredName;
    const base = preferredName.replace(/\.epub$/i, "").replace(/ \[(?:TXT|EPUB)(?: \d+)?\]$/i, "");
    let sequence = 2;
    let candidate = base + " [" + format + " " + sequence + "].epub";
    while (existingNames.has(candidate)) {
      sequence += 1;
      candidate = base + " [" + format + " " + sequence + "].epub";
    }
    return candidate;
  }

  async function validateEpub(arrayBuffer) {
    try {
      const archive = await JSZip.loadAsync(arrayBuffer);
      if (!archive.file("META-INF/container.xml")) {
        throw new Error("缺少 EPUB 容器描述文件");
      }
    } catch (err) {
      throw new Error("文件不是可读取的 EPUB，或文件已经损坏。" + (err && err.message ? "（" + err.message + "）" : ""));
    }
  }

  // 统一文件处理方法：每次导入都先解析现有书名，避免同名文件静默覆盖。
  async function handleImportFile(file) {
    if (!file) return;
    const isEpub = file.name.toLowerCase().endsWith(".epub");
    const isTxt = file.name.toLowerCase().endsWith(".txt");

    if (!isEpub && !isTxt) {
      showImportStatus("无法导入：目前仅支持 EPUB 或 TXT。", "error");
      alert("目前仅支持 .epub 或 .txt 格式的电子书文件。");
      return;
    }
    showImportStatus("正在读取《" + file.name.replace(/\.(?:epub|txt)$/i, "") + "》…", "working");
    try {
      const sourceBuffer = await file.arrayBuffer();
      const books = await window.getAllBooksMeta();
      const existingNames = new Set(books.map(function (item) { return item.name; }));
      let arrayBuffer = sourceBuffer;
      let finalName = file.name;
      let successDetail = "EPUB";

      if (isEpub) {
        await validateEpub(sourceBuffer);
        finalName = makeUniqueBookName(file.name, existingNames, "EPUB");
      } else {
        const decoded = decodeTxt(sourceBuffer);
        const title = file.name.replace(/\.txt$/i, "");
        const converted = await txtToEpubArrayBuffer(decoded.text, title);
        arrayBuffer = converted.data;
        finalName = makeUniqueBookName(title + " [TXT].epub", existingNames, "TXT");
        successDetail = "TXT · " + decoded.encoding + " · " + (converted.detected ? "已识别 " + converted.chapterCount + " 章" : "未检测到章节，按正文阅读");
      }

      await window.saveBookToDB({ name: finalName, data: arrayBuffer });
      await renderBooks();
      const booksNav = document.querySelector('[data-target="view-books"]');
      if (booksNav && !booksNav.classList.contains("active")) booksNav.click();
      showImportStatus("已导入：" + successDetail + " · 保存为《" + finalName.replace(/\.epub$/i, "") + "》", "success");
    } catch(err) {
      console.error("导入失败:", err);
      const message = "导入失败：" + (err && err.message ? err.message : "无法读取文件");
      showImportStatus(message, "error");
      alert(message);
    }
  }

  function getBookTone(name) {
    let total = 0;
    for (let i = 0; i < name.length; i++) total = (total + name.charCodeAt(i)) % 5;
    return total;
  }

  function renderEmptyBooks(grid) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-mark" aria-hidden="true"></div>
        <h2>从一本真正想读的书开始</h2>
        <p>导入你拥有的 EPUB 或 TXT。书籍保存在浏览器本地，之后会从上次停下的位置继续。</p>
        <div class="empty-actions">
          <button class="empty-import" type="button">选择本地书籍</button>
          <span class="empty-formats">EPUB · TXT</span>
        </div>
      </div>`;
    const emptyImport = grid.querySelector('.empty-import');
    if (emptyImport) emptyImport.addEventListener('click', () => document.getElementById('lib-file-input').click());
  }

  // 渲染书籍：只读取既有进度键，用于区分“开始阅读 / 继续阅读”，不增加数据模型
  async function renderBooks() {
    const grid = document.getElementById('book-grid');
    const count = document.getElementById('book-count');
    grid.innerHTML = '<div class="loading-state">正在读取本地书架…</div>';
    try {
      const books = await window.getAllBooksMeta();
      if (count) count.textContent = books.length ? `本机共有 ${books.length} 本书` : '书架暂时为空';
      if (books.length === 0) {
        renderEmptyBooks(grid);
        return;
      }

      let storedProgress = {};
      try {
        storedProgress = await chrome.storage.local.get(books.map(b => 'progress:' + b.name.replace(/\.epub$/i, '')));
      } catch (e) { /* 进度读取失败不影响书架展示 */ }

      grid.innerHTML = '';
      books.forEach(b => {
        const displayName = b.name.replace(/\.epub$/i, '');
        const hasProgress = !!storedProgress['progress:' + displayName];
        const card = document.createElement('article');
        card.className = 'book-card tone-' + getBookTone(displayName);
        card.tabIndex = 0;
        card.setAttribute('aria-label', `${hasProgress ? '继续阅读' : '开始阅读'}《${displayName}》`);

        const delBtn = document.createElement('button');
        delBtn.className = 'btn-delete-book';
        delBtn.type = 'button';
        delBtn.title = '从本地删除此书';
        delBtn.setAttribute('aria-label', `删除《${displayName}》`);
        delBtn.textContent = '×';

        const cover = document.createElement('div');
        cover.className = 'book-cover';
        const coverTitle = document.createElement('span');
        coverTitle.textContent = displayName;
        cover.appendChild(coverTitle);

        const info = document.createElement('div');
        info.className = 'book-info';
        const title = document.createElement('h2');
        title.className = 'book-title';
        title.textContent = displayName;
        const meta = document.createElement('div');
        meta.className = 'book-meta';
        const local = document.createElement('span');
        local.textContent = '本地书籍';
        const state = document.createElement('span');
        state.className = 'book-read-state';
        state.textContent = hasProgress ? '继续阅读' : '开始阅读';
        meta.appendChild(local);
        meta.appendChild(state);
        info.appendChild(title);
        info.appendChild(meta);
        card.appendChild(delBtn);
        card.appendChild(cover);
        card.appendChild(info);

        const openBook = () => { window.location.href = `reader.html?book=${encodeURIComponent(b.name)}`; };
        card.addEventListener('click', e => { if (!e.target.closest('.btn-delete-book')) openBook(); });
        card.addEventListener('keydown', e => {
          if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('.btn-delete-book')) {
            e.preventDefault();
            openBook();
          }
        });
        delBtn.addEventListener('click', async e => {
          e.stopPropagation();
          if (confirm(`确定要从本地删除《${displayName}》吗？相关提取缓存也会一并删除。`)) {
            await window.deleteBookFromDB(b.name);
            renderBooks();
          }
        });
        grid.appendChild(card);
      });
    } catch (e) {
      grid.innerHTML = '';
      const error = document.createElement('div');
      error.className = 'loading-state';
      error.textContent = '书架加载失败：' + e.message;
      grid.appendChild(error);
      if (count) count.textContent = '无法读取本地书架';
    }
  }

  function createPrincipleButton(label, extraClass, iconPath) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'book-action ' + extraClass;
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${iconPath}</svg><span>${label}</span>`;
    return button;
  }

  function renderEmptyPrinciples(list) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-mark" aria-hidden="true"></div>
        <h2>值得留下的内容，会在这里重逢</h2>
        <p>在陪读回答下选择“收藏为知识晶体”，即可按来源回看、复制或删除。</p>
      </div>`;
  }

  // 渲染知识晶体：来源 → 核心内容 → 回看 / 复制 / 删除
  async function renderPrinciples() {
    const list = document.getElementById('principle-list');
    const count = document.getElementById('principle-count');
    list.innerHTML = '<div class="loading-state">正在读取知识晶体…</div>';
    try {
      const [principles, books] = await Promise.all([
        window.getAllPrinciples(),
        window.getAllBooksMeta()
      ]);
      principles.sort((a, b) => b.timestamp - a.timestamp);
      if (count) count.textContent = `${principles.length} 条本地收藏`;
      if (principles.length === 0) {
        renderEmptyPrinciples(list);
        return;
      }

      list.innerHTML = '';
      principles.forEach(p => {
        const sourceName = p.bookName || '未命名书籍';
        const sourceBook = books.find(b => b.name === sourceName || b.name.replace(/\.epub$/i, '') === sourceName);
        const card = document.createElement('article');
        card.className = 'principle-card';

        const source = document.createElement('header');
        source.className = 'principle-source';
        const sourceInfo = document.createElement('div');
        const sourceLabel = document.createElement('span');
        sourceLabel.className = 'source-label';
        sourceLabel.textContent = '来源';
        const sourceTitle = document.createElement('span');
        sourceTitle.className = 'source-book';
        sourceTitle.textContent = `《${sourceName}》`;
        sourceInfo.appendChild(sourceLabel);
        sourceInfo.appendChild(sourceTitle);
        const savedAt = new Date(p.timestamp);
        const validSavedAt = !Number.isNaN(savedAt.getTime());
        const time = document.createElement('time');
        time.className = 'source-time';
        if (validSavedAt) time.dateTime = savedAt.toISOString();
        time.textContent = validSavedAt ? savedAt.toLocaleString() : '保存时间未知';
        source.appendChild(sourceInfo);
        source.appendChild(time);

        const content = document.createElement('div');
        content.className = 'principle-content';
        const text = document.createElement('div');
        text.className = 'p-text';
        if (typeof window.renderMarkdown === 'function') text.innerHTML = window.renderMarkdown(p.text);
        else text.textContent = p.text;
        content.appendChild(text);

        const actions = document.createElement('footer');
        actions.className = 'principle-actions';
        const review = createPrincipleButton('回到原书', 'primary', '<path d="M15 18l-6-6 6-6"/>');
        const copy = createPrincipleButton('复制', 'copy', '<path d="M9 8h10v12H9zM5 16H4V4h10v1"/>');
        const remove = createPrincipleButton('删除', 'delete', '<path d="M5 7h14M9 7V4h6v3M8 10v7M12 10v7M16 10v7M7 20h10l1-13H6l1 13z"/>');
        actions.appendChild(review);
        actions.appendChild(copy);

        if (String(p.text || '').length > 700) {
          content.classList.add('is-collapsed');
          const expand = createPrincipleButton('展开全文', 'expand', '<path d="M7 10l5 5 5-5"/>');
          expand.addEventListener('click', () => {
            const collapsed = content.classList.toggle('is-collapsed');
            expand.querySelector('span').textContent = collapsed ? '展开全文' : '收起全文';
          });
          actions.appendChild(expand);
        }
        actions.appendChild(remove);
        card.appendChild(source);
        card.appendChild(content);
        card.appendChild(actions);

        review.addEventListener('click', () => {
          if (sourceBook) window.location.href = `reader.html?book=${encodeURIComponent(sourceBook.name)}`;
          else alert('原书已不在本地书架中，这条知识晶体仍会保留。');
        });
        copy.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(p.text);
            copy.querySelector('span').textContent = '已复制';
            setTimeout(() => { copy.querySelector('span').textContent = '复制'; }, 2000);
          } catch (err) {
            alert('复制失败，请手动选择内容复制。');
          }
        });
        remove.addEventListener('click', async () => {
          if (confirm('确定要删除这条知识晶体吗？此操作不会删除原书。')) {
            await window.deletePrinciple(p.id);
            renderPrinciples();
          }
        });
        list.appendChild(card);
      });
    } catch (e) {
      list.innerHTML = '';
      const error = document.createElement('div');
      error.className = 'loading-state';
      error.textContent = '知识晶体加载失败：' + e.message;
      list.appendChild(error);
      if (count) count.textContent = '无法读取本地收藏';
    }
  }

  // 导入新书
  const fileInput = document.getElementById('lib-file-input');
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    handleImportFile(file);
    fileInput.value = ""; // 重置
  });

  // 全局拖拽拦截
  let dragCounter = 0;
  const dragOverlay = document.getElementById('drag-overlay');

  document.addEventListener('dragenter', (e) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      dragCounter++;
      dragOverlay.style.display = 'flex';
    }
  });

  document.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter === 0) dragOverlay.style.display = 'none';
  });

  document.addEventListener('dragover', (e) => e.preventDefault());

  document.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    dragOverlay.style.display = 'none';
    const file = e.dataTransfer.files[0];
    handleImportFile(file);
  });

  // 初始化
  renderBooks();
})();
