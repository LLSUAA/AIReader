(function () {
  "use strict";

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

  // TXT 编码探测：优先 UTF-8（严格模式），失败回退 GB18030（GBK 超集，覆盖国内常见 TXT）
  function decodeTxt(arrayBuffer) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(arrayBuffer);
    } catch (e) { /* UTF-8 解码失败，继续回退 */ }
    try {
      return new TextDecoder("gb18030").decode(arrayBuffer);
    } catch (e) { /* 回退失败，按默认处理 */ }
    return new TextDecoder("utf-8").decode(arrayBuffer);
  }

  // 黑科技：在内存中将纯文本 TXT 实时封装为标准 EPUB 结构 (优化版排版)
  async function txtToEpubArrayBuffer(txtContent, title) {
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip");
    zip.file("META-INF/container.xml", `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);

    // 核心优化 1：过滤纯空行，防止 txt 自带的换行导致 <br/> 叠加引发行距爆炸
    const htmlContent = txtContent.split(/\r?\n/).map(line => {
      const safeLine = line.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return safeLine ? `<p>${safeLine}</p>` : '';
    }).filter(Boolean).join('');

    const safeTitleXml = escapeXml(title);
    const opf = `<?xml version="1.0" encoding="UTF-8"?><package version="2.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${safeTitleXml}</dc:title><dc:language>zh-CN</dc:language></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="chapter" href="chapter.html" media-type="application/xhtml+xml"/></manifest><spine toc="ncx"><itemref idref="chapter"/></spine></package>`;
    zip.file("OEBPS/content.opf", opf);

    const ncx = `<?xml version="1.0" encoding="UTF-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="BookId"/></head><docTitle><text>${safeTitleXml}</text></docTitle><navMap><navPoint id="navPoint-1" playOrder="1"><navLabel><text>正文</text></navLabel><content src="chapter.html"/></navPoint></navMap></ncx>`;
    zip.file("OEBPS/toc.ncx", ncx);

    // 核心优化 2：注入出版级 CSS (放大字号，规范行距，文本两端对齐)
    const chapterHtml = `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd"><html xmlns="http://www.w3.org/1999/xhtml">
    <head>
      <title>${escapeHtml(title)}</title>
      <style>
        body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; font-size: 1.25em; line-height: 1.65; padding: 2% 4%; color: inherit; }
        p { margin: 0.3em 0; text-align: justify; text-indent: 2em; }
      </style>
    </head>
    <body>${htmlContent}</body></html>`;
    zip.file("OEBPS/chapter.html", chapterHtml);

    return await zip.generateAsync({ type: "arraybuffer" });
  }

  // 导航切换
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (item.getAttribute('target') === "_blank") return;
      e.preventDefault();
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      document.querySelectorAll('.view-section').forEach(v => v.style.display = 'none');
      
      item.classList.add('active');
      document.getElementById(item.dataset.target).style.display = 'block';
      
      if (item.dataset.target === 'view-books') renderBooks();
      if (item.dataset.target === 'view-arsenal') renderPrinciples();
    });
  });

  // 统一文件处理方法
  function handleImportFile(file) {
    if (!file) return;
    const isEpub = file.name.toLowerCase().endsWith(".epub");
    const isTxt = file.name.toLowerCase().endsWith(".txt");

    if (!isEpub && !isTxt) {
      return alert("⚠️ 目前仅支持 .epub 或 .txt 格式的电子书文件！");
    }

    const reader = new FileReader();
    reader.onload = async function(event) {
      try {
        let arrayBuffer;
        let finalName = file.name;

        if (isEpub) {
          arrayBuffer = event.target.result;
        } else if (isTxt) {
          // TXT 转换逻辑：编码探测（UTF-8 优先，GBK/GB18030 回退），再封装成 EPUB
          const txtContent = decodeTxt(event.target.result);
          const title = file.name.replace(/\.txt$/i, "");
          arrayBuffer = await txtToEpubArrayBuffer(txtContent, title);
          finalName = title + ".epub"; // 强制以后缀名统一存储
        }

        await window.saveBookToDB({ name: finalName, data: arrayBuffer });
        renderBooks();
        document.querySelector('[data-target="view-books"]').click();
      } catch(err) {
        alert("导入失败：" + err.message);
      }
    };
    // 统一以 ArrayBuffer 读取，方便 TextDecoder 处理不同编码
    reader.readAsArrayBuffer(file);
  }

  // 渲染书籍
  async function renderBooks() {
    const grid = document.getElementById('book-grid');
    grid.innerHTML = '加载中...';
    try {
      const books = await window.getAllBooksMeta();
      if (books.length === 0) {
        grid.innerHTML = `
          <div style="grid-column: 1/-1; text-align: center; padding: 80px 0; color: var(--text-muted);">
            <div style="font-size: 56px; margin-bottom: 16px; opacity: 0.6;">📚</div>
            <h3 style="color: #fff; margin-bottom: 8px; font-weight: 500;">书架空空如也</h3>
            <p>请点击右上角导入，或直接将 EPUB 文件拖拽至当前页面</p>
          </div>`;
        return;
      }
      grid.innerHTML = '';
      books.forEach(b => {
        const card = document.createElement('div');
        card.className = 'book-card';
        card.innerHTML = `
          <button class="btn-delete-book" title="删除此书">×</button>
          <div class="book-icon">📚</div>
          <div class="book-title">${b.name.replace(/\.epub$/i, "")}</div>
        `;
        // 点击阅读
        card.addEventListener('click', (e) => {
          if (e.target.classList.contains('btn-delete-book')) return;
          window.location.href = `reader.html?book=${encodeURIComponent(b.name)}`;
        });
        // 删除书籍
        const delBtn = card.querySelector('.btn-delete-book');
        delBtn.addEventListener('click', async () => {
          if (confirm(`确定要从本地删除《${b.name}》吗？`)) {
            await window.deleteBookFromDB(b.name);
            renderBooks();
          }
        });
        grid.appendChild(card);
      });
    } catch (e) { grid.innerHTML = '加载失败: ' + e.message; }
  }

  // 渲染知识晶体
  async function renderPrinciples() {
    const list = document.getElementById('principle-list');
    list.innerHTML = '加载中...';
    try {
      const principles = await window.getAllPrinciples();
      // 按时间倒序
      principles.sort((a, b) => b.timestamp - a.timestamp);
      
      if (principles.length === 0) {
        list.innerHTML = '<div style="color: var(--text-muted);">还没有收藏任何知识晶体。在阅读时与导师对话并点击🌟即可收藏。</div>';
        return;
      }
      list.innerHTML = '';
      principles.forEach(p => {
        const card = document.createElement('div');
        card.className = 'principle-card';
        const dateStr = new Date(p.timestamp).toLocaleString();
        const renderedText = typeof window.renderMarkdown !== 'undefined' ? window.renderMarkdown(p.text) : p.text;
        card.innerHTML = `
          <div class="p-meta"><span>来源：《${p.bookName}》</span><span>${dateStr}</span></div>
          <div class="p-text">${renderedText}</div>
          <div class="p-actions">
            <button class="btn-action-p copy">复制</button>
            <button class="btn-action-p delete">删除</button>
          </div>
        `;
        // 复制事件
        card.querySelector('.btn-action-p.copy').addEventListener('click', async (e) => {
          try {
            await navigator.clipboard.writeText(p.text);
            const btn = e.target;
            btn.textContent = "已复制";
            setTimeout(() => btn.textContent = "复制", 2000);
          } catch(err) {
            alert("复制失败");
          }
        });
        // 删除事件
        card.querySelector('.btn-action-p.delete').addEventListener('click', async () => {
          if (confirm("确定要删除这条知识晶体吗？")) {
            await window.deletePrinciple(p.id);
            renderPrinciples();
          }
        });
        list.appendChild(card);
      });
    } catch (e) { list.innerHTML = '加载失败: ' + e.message; }
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
