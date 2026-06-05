var $ = function (sel) { return document.querySelector(sel); };

var defaults = {
  apikey: "",
  model: "deepseek-v4-flash",
  endpoint: "https://api.deepseek.com/chat/completions"
};

function normalizeEndpoint(raw) {
  if (!raw) return defaults.endpoint;
  if (raw.endsWith("/chat/completions")) return raw;
  return raw.replace(/\/+$/, "") + "/chat/completions";
}

function showToast(msg, type) {
  var el = $("#toast");
  el.textContent = msg;
  el.className = "toast " + type;
  el.style.display = "block";
  setTimeout(function () { el.style.display = "none"; }, 3000);
}

async function loadConfig() {
  try {
    var result = await chrome.storage.local.get(["apikey", "model", "endpoint"]);
    $("#apikey").value = result.apikey || defaults.apikey;
    $("#model").value = result.model || defaults.model;
    $("#endpoint").value = result.endpoint || defaults.endpoint;
  } catch (e) {
    showToast("加载配置失败: " + e.message, "error");
  }
}

async function saveConfig() {
  var apikey = $("#apikey").value.trim();
  var model = $("#model").value.trim();
  var endpoint = $("#endpoint").value.trim();

  if (!apikey) {
    showToast("API Key 不能为空", "error");
    return;
  }
  if (!endpoint) {
    showToast("API Endpoint 不能为空", "error");
    return;
  }

  // 存储前做标准化处理
  var normalizedEndpoint = normalizeEndpoint(endpoint);

  try {
    await chrome.storage.local.set({ apikey: apikey, model: model, endpoint: normalizedEndpoint });
    $("#endpoint").value = normalizedEndpoint;
    showToast("配置已保存", "success");
  } catch (e) {
    showToast("保存失败: " + e.message, "error");
  }
}

async function testConnection() {
  var apikey = $("#apikey").value.trim();
  var model = $("#model").value.trim() || "deepseek-v4-flash";
  var endpoint = normalizeEndpoint($("#endpoint").value.trim());

  if (!apikey) {
    showToast("请先填写 API Key", "error");
    return;
  }

  showToast("正在测试连接...", "success");

  try {
    var resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + apikey
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: "user", content: "Hi" }],
        temperature: 0.7,
        max_tokens: 5,
        stream: false
      })
    });

    if (resp.ok) {
      showToast("连接成功! API 响应正常。", "success");
    } else {
      var err = await resp.text();
      showToast("连接失败 (" + resp.status + "): " + err, "error");
    }
  } catch (e) {
    showToast("网络错误: " + e.message, "error");
  }
}

$("#btn-save").addEventListener("click", saveConfig);
$("#btn-test").addEventListener("click", testConnection);
$("#btn-close").addEventListener("click", function() { window.close(); });

loadConfig();