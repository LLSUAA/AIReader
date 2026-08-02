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

  // 从模型输出中容错提取 JSON 对象（兼容带代码围栏/前后说明文字的输出）
  global.extractJSONContent = function(content) {
    if (!content) throw new Error("模型未返回内容");
    let text = String(content).trim();
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) text = fence[1].trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("无法从模型输出中解析 JSON");
    return JSON.parse(text.substring(start, end + 1));
  };

  // 非流式 JSON 请求：用于全书提取的 Map（逐块摘要）/ Reduce（全局综合）
  global.requestJSON = async function(messages, model, endpoint, apikey, options) {
    options = options || {};
    const maxTokens = options.maxTokens || 2000;
    const signal = options.signal || undefined;
    const temperature = typeof options.temperature === "number" ? options.temperature : 0.3;

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

    // 优先使用 JSON 输出模式；部分端点/模型不支持 response_format 时回退为普通模式（400/422 均回退）
    let response = await doFetch(Object.assign({}, bodyBase, { response_format: { type: "json_object" } }));
    if (response.status === 400 || response.status === 422) {
      response = await doFetch(bodyBase);
    }
    if (!response.ok) {
      throw new Error("API 错误 (" + response.status + "): " + await response.text());
    }

    const data = await response.json();
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    return global.extractJSONContent(content);
  };

  // 粗略 token 估算（中英混排按 2 字符 ≈ 1 token），用于进度与成本提示
  global.estimateTokens = function(text) {
    return Math.ceil(String(text || "").length / 2);
  };

})(window);
