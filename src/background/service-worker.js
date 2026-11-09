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

// 与 manifest 的 content_scripts 保持一致：补注入时按同一顺序执行
const CONTENT_FILES = [
  'src/shared/langs.js',
  'src/shared/storage.js',
  'src/content/classifier.js',
  'src/content/protector.js',
  'src/content/tooltip.js',
  'src/content/hover.js',
  'src/content/selection.js',
  'src/content/dynamic.js',
  'src/content/content.js'
];

// 工具栏角标：没有面板可看时，用它给出「进行中/成功/失败」信号
function setBadge(text, color) {
  try {
    chrome.action.setBadgeBackgroundColor({ color: color || '#dc2626' });
    chrome.action.setBadgeText({ text: text || '' });
  } catch (e) { /* 忽略：角标只是辅助反馈 */ }
}

function flashBadge(text, color) {
  setBadge(text, color);
  if (text) {
    setTimeout(function () { chrome.action.setBadgeText({ text: '' }); }, 4000);
  }
}

async function runOnActiveTab(msg, showProgress) {
  if (showProgress) setBadge('…', '#2563eb');
  const r = await sendToActiveTab(msg);
  if (r && r.error) flashBadge('!', '#dc2626');
  else flashBadge('✓', '#16a34a');
  return r;
}

function sendOnce(tabId, msg) {
  return new Promise(function (resolve) {
    chrome.tabs.sendMessage(tabId, msg, function (resp) {
      if (chrome.runtime.lastError) {
        resolve({ __noReceiver: true, error: chrome.runtime.lastError.message });
      } else {
        resolve(resp || {});
      }
    });
  });
}

// 补注入：扩展安装/重载前就打开的页面里没有内容脚本，Chrome 不会自动补，
// 这时右键菜单/快捷键发过去的消息会静默失败（用户看到的就是「点了没反应」）。
async function injectContentScripts(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: CONTENT_FILES
    });
    return true;
  } catch (e) {
    return false;
  }
}

async function sendToActiveTab(msg) {
  const tab = await activeTab();
  if (!tab || !tab.id) {
    flashBadge('!');
    return { error: '没有可用的标签页' };
  }

  let resp = await sendOnce(tab.id, msg);
  if (!resp.__noReceiver) {
    flashBadge('');
    return resp;
  }

  // 页面里没有可用的内容脚本 → 自动补注入，再发一次
  const injected = await injectContentScripts(tab.id);
  if (!injected) {
    flashBadge('!');
    return { error: '此页面不允许扩展运行（chrome:// 内部页、扩展页、应用商店）' };
  }
  await new Promise(function (r) { setTimeout(r, 150); });

  resp = await sendOnce(tab.id, msg);
  if (resp.__noReceiver) {
    flashBadge('!');
    return { error: '已补注入脚本但页面仍无响应，请刷新页面重试' };
  }
  flashBadge('');
  return resp;
}

chrome.contextMenus.onClicked.addListener(function (info) {
  if (info.menuItemId === 'lp-translate') {
    runOnActiveTab({ type: 'LP_TRANSLATE_PAGE' }, true);
  }
  if (info.menuItemId === 'lp-restore') {
    runOnActiveTab({ type: 'LP_RESTORE' }, false);
  }
});

chrome.commands.onCommand.addListener(function (cmd) {
  if (cmd === 'translate-page') {
    runOnActiveTab({ type: 'LP_TRANSLATE_PAGE' }, true);
  }
  if (cmd === 'restore-page') {
    runOnActiveTab({ type: 'LP_RESTORE' }, false);
  }
});
