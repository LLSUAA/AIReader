/* ============================================
   读见 - 品牌常量
   用户品牌：读见
   产品定位：深度阅读与知识提取工具
   品牌口号：读进去，想明白

   兼容说明：legacyName、dbName 与 cfiProtocol 是历史内部标识，暂不改动，避免升级后丢失本地数据或旧缓存。
   ============================================ */
(function (global) {
  "use strict";

  global.DUJIAN_BRAND = Object.freeze({
    name: "读见",
    subtitle: "深度阅读与知识提取工具",
    slogan: "读进去，想明白",
    legacyName: "AIReader",
    dbName: "AIReaderDB",
    cfiProtocol: "aireader-cfi"
  });
})(window);
