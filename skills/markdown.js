/* ============================================
   读见 - 安全 Markdown 渲染层
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
    try {
      var renderer = new marked.Renderer();
      renderer.html = function (token) {
        var raw = typeof token === "string" ? token : (token && token.text) || "";
        return escapeHtml(raw);
      };

      renderer.link = function (href, title, text) {
        // marked v15 传 token 对象（{href,title,tokens}），旧版传三个位置参数
        var safeHref = "";
        var safeTitle = "";
        var linkText = "";
        var tokens = null;
        if (href && typeof href === "object") {
          safeHref = href.href || "";
          safeTitle = href.title || "";
          linkText = href.text || "";
          tokens = href.tokens || null;
        } else {
          safeHref = href || "";
          safeTitle = title || "";
          linkText = text || "";
        }
        // aireader-cfi 是历史站内溯源协议，必须保留以兼容旧缓存；其余未知协议一律拦截
        if (!/^(https?:|mailto:|aireader-cfi:)/i.test(safeHref)) safeHref = "#";
        var inner = escapeHtml(linkText);
        if (tokens && this.parser && typeof this.parser.parseInline === "function") {
          try {
            inner = this.parser.parseInline(tokens);
          } catch (e) { /* 内联解析失败退回纯文本 */ }
        }
        return '<a href="' + escapeHtml(safeHref) + '"' +
          (safeTitle ? ' title="' + escapeHtml(safeTitle) + '"' : "") +
          ' target="_blank" rel="noopener noreferrer nofollow">' + inner + "</a>";
      };

      marked.setOptions({ renderer: renderer, breaks: true, gfm: true });
      return marked.parse(text || "");
    } catch (e) {
      // 渲染器异常时降级为纯文本，绝不阻断展示流程
      console.error("Markdown 渲染失败，降级为纯文本:", e);
      return escapeHtml(String(text || ""));
    }
  };
})(window);
