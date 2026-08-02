/* ============================================
   AIReader - 安全 Markdown 渲染层
   AI 输出不可信：转义原始 HTML，外链强制安全属性
   所有 marked 渲染必须经过本文件出口
   ============================================ */
(function (global) {
  "use strict";

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // 安全渲染：丢弃原始 HTML 块，仅以转义文本呈现；外链加 noopener/noreferrer/nofollow
  global.renderMarkdown = function (text) {
    if (typeof marked === "undefined") return text;

    var renderer = new marked.Renderer();
    renderer.html = function (token) {
      var raw = typeof token === "string" ? token : (token && token.text) || "";
      return escapeHtml(raw);
    };

    var origLink = renderer.link;
    renderer.link = function (href, title, text) {
      var safeHref = href || "";
      if (!/^(https?:|mailto:)/i.test(safeHref)) safeHref = "#";
      var out = origLink.call(renderer, safeHref, title, text);
      return out.replace(/^<a /, '<a target="_blank" rel="noopener noreferrer nofollow" ');
    };

    marked.setOptions({ renderer: renderer, breaks: true, gfm: true });
    return marked.parse(text || "");
  };
})(window);
