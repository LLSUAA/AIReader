(function (global) {
  "use strict";

  // 数据库名属于历史内部标识，品牌迁移时保持不变，确保已有本地数据继续可读。
  const DB_NAME = "AIReaderDB";
  const STORE_NAME = "books";
  const DB_VERSION = 3;

  function getDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
        if (!db.objectStoreNames.contains("principles")) {
          db.createObjectStore("principles", { keyPath: "id", autoIncrement: true });
        }
        if (!db.objectStoreNames.contains("extractions")) {
          db.createObjectStore("extractions", { keyPath: "bookName" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // 1. 保存书籍：使用书名作为唯一 Key，实现多书共存
  global.saveBookToDB = async function(bookData) {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(bookData, bookData.name);
    return new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });
  };

  // 2. 获取单本书
  global.getBookFromDB = async function(bookName) {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(bookName);
    return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = reject; });
  };

  // 3. 获取所有书籍列表（不包含二进制 data，防止内存爆炸）
  global.getAllBooksMeta = async function() {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAll();
    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const books = request.result || [];
        resolve(books.map(b => ({ name: b.name })));
      };
      request.onerror = reject;
    });
  };

  // 4. 删除单本书
  global.deleteBookFromDB = async function(bookName) {
    const db = await getDB();
    const tx = db.transaction([STORE_NAME, "extractions"], "readwrite");
    tx.objectStore(STORE_NAME).delete(bookName);
    // 级联清理：删除书籍时同步删除其全书提取缓存
    const cleanName = String(bookName).replace(/\.epub$/i, "");
    tx.objectStore("extractions").delete(cleanName);
    return new Promise((resolve) => { tx.oncomplete = resolve; });
  };

  // 5. 获取所有知识晶体
  global.getAllPrinciples = async function() {
    const db = await getDB();
    const tx = db.transaction("principles", "readonly");
    const request = tx.objectStore("principles").getAll();
    return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = reject; });
  };

  // 6. 删除知识晶体
  global.deletePrinciple = async function(id) {
    const db = await getDB();
    const tx = db.transaction("principles", "readwrite");
    tx.objectStore("principles").delete(id);
    return new Promise((resolve) => { tx.oncomplete = resolve; });
  };

  // ---- 向后兼容旧接口 ----
  global.loadBookFromDB = async function() {
    // 旧接口：返回第一本书（兼容 reader.js 的自动恢复逻辑）
    const meta = await global.getAllBooksMeta();
    if (meta && meta.length > 0) {
      return global.getBookFromDB(meta[0].name);
    }
    return null;
  };

  global.clearBookFromDB = async function() {
    // 旧接口：清空所有书籍（兼容 reader.js 的关闭逻辑）
    const meta = await global.getAllBooksMeta();
    for (const b of meta) {
      await global.deleteBookFromDB(b.name);
    }
  };

  global.savePrincipleToDB = async function(principleData) {
    const db = await getDB();
    const tx = db.transaction("principles", "readwrite");
    tx.objectStore("principles").add(principleData);
    return new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });
  };

  // ---- 全书提取结果缓存（keyPath: bookName，一书一条，避免重复扣费） ----
  global.getExtraction = async function(bookName) {
    const db = await getDB();
    const tx = db.transaction("extractions", "readonly");
    const request = tx.objectStore("extractions").get(bookName);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = reject;
    });
  };

  global.saveExtraction = async function(extractionData) {
    const db = await getDB();
    const tx = db.transaction("extractions", "readwrite");
    tx.objectStore("extractions").put(extractionData);
    return new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });
  };

  global.deleteExtraction = async function(bookName) {
    const db = await getDB();
    const tx = db.transaction("extractions", "readwrite");
    tx.objectStore("extractions").delete(bookName);
    return new Promise((resolve) => { tx.oncomplete = resolve; });
  };

})(window);
