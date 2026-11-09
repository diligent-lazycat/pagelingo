/**
 * Background Service Worker：负责翻译 API 调用与消息路由。
 * 之所以把翻译请求放在后台而非内容脚本，是为了规避页面 CSP 对 fetch 的限制，
 * 并统一做限流与错误处理。
 */
importScripts('engines.js');

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg && msg.type === 'LP_TRANSLATE') {
    handleTranslate(msg)
      .then(function (r) { sendResponse(r); })
      .catch(function (err) { sendResponse({ error: err.message || String(err) }); });
    return true; // 异步响应
  }
  if (msg && msg.type === 'LP_DIAGNOSE') {
    diagnose(msg.sl || 'en', msg.tl || 'zh-CN', msg.customEndpoint || '', msg.deeplKey || '')
      .then(function (r) { sendResponse({ results: r }); })
      .catch(function (err) { sendResponse({ error: err.message || String(err) }); });
    return true;
  }
  return false;
});

async function handleTranslate(msg) {
  const texts = Array.isArray(msg.texts) ? msg.texts : [msg.texts];
  const sl = msg.sl || 'auto';
  const tl = msg.tl || 'zh-CN';
  const engine = msg.engine || 'auto';
  const customEndpoint = msg.customEndpoint || '';
  const deeplKey = msg.deeplKey || '';

  const out = await translate(texts, sl, tl, engine, customEndpoint, deeplKey);
  // auto 模式返回 { translations, engine }，其它模式返回数组
  if (Array.isArray(out)) return { translations: out };
  return { translations: out.translations, engine: out.engine };
}

// ---------------------------------------------------------------- 触发入口
// 除了点工具栏图标打开面板，再提供「右键菜单」与「键盘快捷键」两条路径：
// 面板打不开、图标被折叠、或在内部页上误点时，这两条都能直接干活。

function setupMenus() {
  chrome.contextMenus.removeAll(function () {
    chrome.contextMenus.create({
      id: 'lp-translate',
      title: '翻译此页面（PageLingo）',
      contexts: ['page', 'selection']
    });
    chrome.contextMenus.create({
      id: 'lp-restore',
      title: '还原原文（PageLingo）',
      contexts: ['page', 'selection']
    });
  });
}

chrome.runtime.onInstalled.addListener(setupMenus);
chrome.runtime.onStartup.addListener(setupMenus);
// service worker 每次被唤醒也补一次：onInstalled 只在安装/更新时触发，
// 而菜单在扩展重载后可能并不存在，这里用 removeAll→create 保证幂等
setupMenus();

function activeTab() {
  return new Promise(function (resolve) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      resolve(tabs && tabs[0]);
    });
  });
}

// 给当前标签页发消息；页面没有内容脚本时返回可直接展示的原因
function sendToActiveTab(msg) {
  return activeTab().then(function (tab) {
    if (!tab || !tab.id) return { error: '没有可用的标签页' };
    return new Promise(function (resolve) {
      chrome.tabs.sendMessage(tab.id, msg, function (resp) {
        if (chrome.runtime.lastError) {
          resolve({
            error: '此页面不支持翻译：浏览器内部页（chrome://、扩展页、应用商店）不行；' +
                   '扩展安装/重载前就已打开的页面需要先刷新一次'
          });
        } else {
          resolve(resp || {});
        }
      });
    });
  });
}

chrome.contextMenus.onClicked.addListener(function (info) {
  if (info.menuItemId === 'lp-translate') sendToActiveTab({ type: 'LP_TRANSLATE_PAGE' });
  if (info.menuItemId === 'lp-restore') sendToActiveTab({ type: 'LP_RESTORE' });
});

chrome.commands.onCommand.addListener(function (cmd) {
  if (cmd === 'translate-page') sendToActiveTab({ type: 'LP_TRANSLATE_PAGE' });
  if (cmd === 'restore-page') sendToActiveTab({ type: 'LP_RESTORE' });
});
