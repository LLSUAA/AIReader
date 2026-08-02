(function (global) {
  "use strict";

  global.SYSTEM_PROMPT = `你是一位拥有跨学科视角与深厚人文底蕴的顶级阅读导师。你的任务是辅助用户进行深度精读，透过文字表象剥离出深层内核，将书中的思想转化为用户的认知框架。
规则：
1. 拒绝被动投喂：直击本质，剥离冗余修饰，不写废话。
2. 审美与语境同频：精准识别文本的体裁。面对社科书，剖析利益博弈与制度演变；面对文学/哲学书，深度挖掘人性幽微、宗教神性或伦理困境。绝对禁止用理科术语（如阈值、模型、闭环）去生硬解构纯文学情感。
3. 跨语境映射：结合文本的固有属性，将其核心概念映射到现实生活、历史规律或心理学现象中，产生认知碰撞。
4. 苏格拉底诘问：在每次回答末尾，必须抛出一个极具穿透力的高阶反问（思想实验或现实困境），测试用户的思想深度与认知边界。`;

  // 技能上下文长度兜底：防止单 spine（尤其 TXT 整本书）一次性全量发送给模型
  const MAX_SKILL_CONTEXT_CHARS = 8000;

  function truncateContext(text, max) {
    text = (text || "").trim();
    if (text.length <= max) return text;
    return text.substring(0, max) + "\n\n[内容过长，已截取前 " + max + " 字；全书分层提取功能开发中，后续将按章节完整分析]";
  }

  global.SKILLS = {
    history: {
      name: "前文复盘回顾",
      getContext: async (rendition, book) => {
        const location = rendition.currentLocation();
        if (!location || location.start.index === 0) return { error: "当前无足够的历史阅读内容可供复盘。" };
        let historyText = "";
        const startIndex = Math.max(0, location.start.index - 2);
        for (let i = startIndex; i < location.start.index; i++) {
          const spineItem = book.spine.get(i);
          await spineItem.load(book.load.bind(book));
          historyText += (spineItem.document.body.textContent || spineItem.document.body.innerText || "").trim() + "\n\n";
        }
        historyText = historyText.trim();
        return { text: historyText.length > 15000 ? historyText.substring(historyText.length - 15000) : historyText };
      },
      buildPrompt: (text) => `作为深度阅读伴侣，请你根据以下读者刚读过的背景内容，给出一份『前情提要与核心主线串联』。
要求：不要报流水账，提取出推动内容发展的隐性线索（如逻辑递进、人物情感裂变、核心冲突演化），帮助复盘底层认知框架：\n\n${text}`
    },
    chapter: {
      name: "提炼本章骨架",
      getContext: async (rendition) => {
        const contents = rendition.getContents();
        if (!contents || contents.length === 0) return { error: "无法提取本章内容。" };
        const text = (contents[0].document.body.textContent || contents[0].document.body.innerText || "").trim();
        return { text: truncateContext(text, MAX_SKILL_CONTEXT_CHARS) };
      },
      buildPrompt: (text) => `请基于以下文本，提炼出本章的结构骨架。
要求：若是论述类文本，提取核心论点与关键论据；若是叙事/文学类文本，提取核心冲突、人物动机或思想演变。以简洁的层级列表呈现，让我一眼看透事物运转或情感演变的第一性原理：\n\n${text}`
    },
    quiz: {
      name: "沙盘推演测验",
      getContext: async (rendition) => global.SKILLS.chapter.getContext(rendition),
      buildPrompt: (text) => `请基于以下文本的核心思想，设定一个极端的现实情境（或思想实验、道德困境、逻辑推演）。
要求：向我抛出一个极其刁钻的压力测试题（必须高度契合原文本的学科和语境），强迫我运用刚读到的底层逻辑进行推演。只提问，等我回答：\n\n${text}`
    },
    explain: {
      name: "解释选中段落",
      getContext: async (rendition) => {
        try {
          const iframeWindow = rendition.getContents()[0].window;
          const selection = iframeWindow.getSelection().toString().trim();
          if (selection) return { text: selection }; // 优先使用用户高亮选中的文字

          // 降级方案：安全截取当前页文本，避免 getRange 死锁
          const text = rendition.getContents()[0].document.body.innerText || "";
          return { text: text.substring(0, 1000) };
        } catch (e) {
          return { error: "提取失败，请尝试用鼠标高亮选中一段文字后重试。" };
        }
      },
      buildPrompt: (text) => `用通俗易懂的语言解释以下文本的深层含义。
要求：解释后，执行『跨语境映射』，给出一个高度契合该文本主题的现实生活案例、历史事件或心理学现象，帮助彻底具象化这个概念，绝对不要局限于单一学科：\n\n${text}`
    }
  };

})(window);
