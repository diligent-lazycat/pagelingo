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
