(function (global) {
  "use strict";

  global.normalizeEndpoint = function(raw) {
    if (!raw) return "https://api.deepseek.com/chat/completions";
    if (raw.endsWith("/chat/completions")) return raw;
    return raw.replace(/\/+$/, "") + "/chat/completions";
  };

  global.streamAIResponse = async function(messages, model, endpoint, apikey, bubbleElement, options) {
    options = options || {};
    const maxTokens = options.maxTokens || 3000;
    bubbleElement.classList.add("loading");
    bubbleElement.textContent = "思考中...";

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apikey },
        body: JSON.stringify({ model: model, messages: messages, temperature: 0.7, max_tokens: maxTokens, stream: true })
      });
      if (!response.ok) throw new Error("API 错误 (" + response.status + "): " + await response.text());

      bubbleElement.classList.remove("loading");
      bubbleElement.textContent = "";

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let fullContent = "";
      let buffer = "";
      let lastRenderAt = 0;

      // 渲染节流：避免长输出时每次 delta 都全量 marked.parse（O(n²)）
      function scheduleRender() {
        const now = Date.now();
        const delay = Math.max(0, 80 - (now - lastRenderAt));
        setTimeout(function () {
          lastRenderAt = Date.now();
          if (typeof global.renderMarkdown !== "undefined") {
            bubbleElement.innerHTML = global.renderMarkdown(fullContent);
          } else {
            bubbleElement.textContent = fullContent;
          }
          const aiOutput = document.getElementById("chat-container");
          if (aiOutput) aiOutput.scrollTop = aiOutput.scrollHeight;
        }, delay);
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith("data: ") && line !== "data: [DONE]") {
            try {
              const data = JSON.parse(line.slice(6));
              const delta = data.choices[0].delta.content;
              if (delta) {
                fullContent += delta;
                scheduleRender();
              }
            } catch (e) { /* 忽略 */ }
          }
        }
      }
      // 流结束后确保最终内容完整上屏
      if (typeof global.renderMarkdown !== "undefined") {
        bubbleElement.innerHTML = global.renderMarkdown(fullContent);
      } else {
        bubbleElement.textContent = fullContent;
      }
      return fullContent;
    } catch (err) {
      bubbleElement.classList.remove("loading");
      bubbleElement.textContent = "❌ 请求失败: " + err.message;
      return null;
    }
  };

  // 从模型输出中容错提取 JSON 对象（兼容代码围栏/前后说明文字/尾逗号/缺失逗号/顶层数组）
  global.extractJSONContent = function(content) {
    if (!content) throw new Error("模型未返回内容");
    let text = String(content).replace(/^\uFEFF/, "").trim();
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) text = fence[1].trim();

    // 定位候选 JSON 区间：优先对象，其次数组
    let candidate = text;
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      candidate = text.substring(start, end + 1);
    } else {
      const arrStart = text.indexOf("[");
      const arrEnd = text.lastIndexOf("]");
      if (arrStart !== -1 && arrEnd > arrStart) {
        candidate = text.substring(arrStart, arrEnd + 1);
      }
    }

    // 容错修复：
    // 1) 删除对象/数组末尾的多余逗号（模型常见输出错误）
    // 2) 在两个字符串/值之间补缺失逗号（如 ["a" "b"]、{"a":1 "b":2}）
    // 修复 1：删除尾逗号；修复 2：补缺失逗号；修复 3：未加引号的键补引号；修复 4：字符串内裸控制字符转义
    const repaired = sanitizeJSONStrings(
      candidate
        .replace(/,\s*([}\]])/g, "$1")
        .replace(/(?<![:\{,])[\t ]+(?=")/g, ",")
        .replace(/([{,]\s*)([A-Za-z_$\u4e00-\u9fff][\w$\u4e00-\u9fff]*)(\s*:)/g, '$1"$2"$3')
        .replace(/[“”]([^”"]+)[“”]\s*:/g, '"$1":')
    );

    let lastErr = null;
    try { return JSON.parse(repaired); } catch (e) { lastErr = e; }
    // 修复可能过度（误伤正常 JSON），退回原始候选
    try { return JSON.parse(candidate); } catch (e) { /* 保留原始错误 */ }
    throw lastErr || new Error("无法从模型输出中解析 JSON");
  };

  // 模型常把换行/回车/Tab 直接写进 JSON 字符串值（未转义），逐字符扫描修复
  function sanitizeJSONStrings(text) {
    let out = "";
    let inString = false;
    let escaped = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) { out += ch; escaped = false; continue; }
        if (ch === "\\") { out += ch; escaped = true; continue; }
        if (ch === '"') { out += ch; inString = false; continue; }
        if (ch === "\n" || ch === "\r" || ch === "\t") {
          out += ch === "\n" ? "\\n" : ch === "\r" ? "\\r" : "\\t";
          continue;
        }
        out += ch;
        continue;
      }
      if (ch === '"') inString = true;
      out += ch;
    }
    return out;
  }

  // 兼容不同厂商的 content 结构：字符串 / 分块数组 / 缺失
  function getMessageContent(message) {
    if (!message) return "";
    const c = message.content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) {
      const parts = c.filter(p => p && typeof p.text === "string").map(p => p.text);
      if (parts.length) return parts.join("\n");
      return JSON.stringify(c);
    }
    return "";
  }

  // 非流式 JSON 请求：用于全书提取的 Map（逐块摘要）/ Reduce（全局综合）
  global.requestJSON = async function(messages, model, endpoint, apikey, options) {
    options = options || {};
    const maxTokens = options.maxTokens || 2000;
    const signal = options.signal || undefined;
    const temperature = typeof options.temperature === "number" ? options.temperature : 0.3;
    const fallbackRaw = !!options.fallbackRaw;

    const headers = { "Content-Type": "application/json", "Authorization": "Bearer " + apikey };
    const bodyBase = { model: model, messages: messages, temperature: temperature, max_tokens: maxTokens, stream: false };

    async function doFetch(body) {
      return fetch(endpoint, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(body),
        signal: signal
      });
    }

    // 优先使用 JSON 输出模式；以下情况自动回退普通模式：
    // 1) 端点报 400/422（不支持 response_format）
    // 2) 返回 200 但 content 为空（部分网关对不支持 JSON 模式的模型静默吞掉输出）
    let attempts = [
      Object.assign({}, bodyBase, { response_format: { type: "json_object" } }),
      bodyBase
    ];
    let lastError = null;
    for (let i = 0; i < attempts.length; i++) {
      const response = await doFetch(attempts[i]);
      if (response.status === 400 || response.status === 422) {
        lastError = new Error("API 错误 (" + response.status + "): " + await response.text());
        continue;
      }
      if (!response.ok) {
        throw new Error("API 错误 (" + response.status + "): " + await response.text());
      }
      const data = await response.json();
      const message = data.choices && data.choices[0] && data.choices[0].message;
      const content = getMessageContent(message);
      if (content && content.trim()) {
        try {
          return global.extractJSONContent(content);
        } catch (e) {
          if (fallbackRaw) {
            // 降级模式：解析失败时把原始输出原样带回，由调用方决定如何使用
            return { __raw: content };
          }
          e.rawContent = content;
          throw e;
        }
      }
      const hasReasoning = message && message.reasoning_content;
      lastError = new Error(
        "模型未返回内容" +
        (hasReasoning
          ? "（检测到模型把 token 用于思维链，请改用非 reasoning 模型，或调大 max_tokens）"
          : "（模型 " + model + " 返回空内容，请检查模型名/端点是否正确）")
      );
      lastError.reasoning = !!hasReasoning;
    }
    throw lastError || new Error("模型未返回内容");
  };

  // 粗略 token 估算（中英混排按 2 字符 ≈ 1 token），用于进度与成本提示
  global.estimateTokens = function(text) {
    return Math.ceil(String(text || "").length / 2);
  };

})(window);
