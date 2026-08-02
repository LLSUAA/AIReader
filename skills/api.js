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

})(window);
