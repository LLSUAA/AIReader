// 监听插件图标的点击事件
chrome.action.onClicked.addListener((tab) => {
  // 点击图标时，在一个全新的全屏标签页中打开大厅
  chrome.tabs.create({ url: 'library.html' });
});