/**
 * 内容脚本入口：串联设置、翻译请求、全页翻译、还原与消息监听。
 * 是唯一与 popup 通信的模块。
 */
window.LinguaPage = window.LinguaPage || {};

(function (LP) {
  LP.settings = null;
  LP.doneTextNodes = new WeakSet(); // 已翻译文本节点
  LP.translatedList = [];            // 可还原的 {node, orig}
  LP.dynamicEnabled = false;

  // ---------------------------------------------------------------- 设置

  LP.getSettings = function () {
    if (!LP.settings) LP.settings = {};
    return LP.settings;
  };

  async function loadSettings() {
    LP.settings = await LP.storage.getAll();
  }

  function applySettings(s) {
    LP.settings = Object.assign({}, LP.settings || {}, s);
    // 关闭全页翻译相关状态时，停止动态翻译
    LP.setDynamicEnabled(!!s.autoDynamic);
  }

  // ---------------------------------------------------------------- 节点判定

  // 判断文本节点是否应跳过（祖先含代码/链接/悬浮框等）
  LP.isSkippedTextNode = function (node) {
    const skipLinks = LP.getSettings().skipLinks;
    let el = node.parentElement;
    while (el) {
      if (el.id === 'lp-tooltip') return true;
      if (skipLinks && el.tagName === 'A') return true;
      if (LP.classifier.shouldSkipElement(el)) return true;
      el = el.parentElement;
    }
    return false;
  };

  // 收集 root 下所有需要翻译的文本节点
  LP.collectTextNodes = function (root, doneSet) {
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        const t = (node.nodeValue || '').trim();
        if (!t) return NodeFilter.FILTER_REJECT;
        if (doneSet && doneSet.has(node)) return NodeFilter.FILTER_REJECT;
        if (LP.isSkippedTextNode(node)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let n;
    while ((n = walker.nextNode())) out.push(n);
    return out;
  };

  // ---------------------------------------------------------------- 翻译请求

  // 向后台发送翻译请求，返回与 texts 等长的结果数组
  async function requestTranslate(texts) {
    const s = LP.getSettings();
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage({
        type: 'LP_TRANSLATE',
        texts: texts,
        sl: s.sourceLang,
        tl: s.targetLang,
        engine: s.engine,
        customEndpoint: s.customEndpoint
      }, function (resp) {
        if (chrome.runtime.lastError) {
          resolve({ error: chrome.runtime.lastError.message });
        } else {
          resolve(resp || {});
        }
      });
    });
  }

  // 分批翻译，返回与 texts 等长的数组（失败批返回原文）
  LP.translateTexts = async function (texts, sl, tl) {
    const CHUNK = 100;
    const flat = [];
    for (let i = 0; i < texts.length; i += CHUNK) {
      const chunk = texts.slice(i, i + CHUNK);
      const resp = await requestTranslate(chunk);
      if (resp.error) {
        flat.push.apply(flat, chunk); // 失败时保留原文
      } else {
        const tr = resp.translations || chunk;
        flat.push.apply(flat, tr);
      }
    }
    return flat;
  };

  // ---------------------------------------------------------------- 写回

  // 翻译一批文本节点并写回，保持原文前后空白
  LP.translateNodes = async function (nodes) {
    if (!nodes || !nodes.length) return;
    const valid = [];
    const texts = [];
    const ws = [];

    for (const node of nodes) {
      if (!node.isConnected) continue;
      if (LP.doneTextNodes.has(node)) continue;
      const raw = node.nodeValue || '';
      const m = raw.match(/^(\s*)([\s\S]*?)(\s*)$/);
      const core = m ? m[2] : raw;
      if (!core.trim()) continue;
      if (LP.isSkippedTextNode(node)) continue;
      valid.push(node);
      texts.push(core);
      ws.push(m ? { lead: m[1], tail: m[3] } : { lead: '', tail: '' });
    }

    if (!texts.length) return;

    const s = LP.getSettings();
    const terms = s.protectTerms ? LP.DEFAULT_TERMS : [];
    const protectedData = texts.map(function (t) { return LP.protector.protect(t, terms); });

    const results = await LP.translateTexts(protectedData.map(function (p) { return p.text; }));

    valid.forEach(function (node, i) {
      const finalText = LP.protector.restore(results[i], protectedData[i].placeholders);
      const w = ws[i];
      // 记录原文以便还原
      LP.translatedList.push({ node: node, orig: node.nodeValue });
      node.nodeValue = w.lead + finalText + w.tail;
      LP.doneTextNodes.add(node);
    });
  };

  // ---------------------------------------------------------------- 全页翻译 / 还原

  LP.translateWholePage = async function () {
    const nodes = LP.collectTextNodes(document.body, LP.doneTextNodes);
    LP.setDynamicEnabled(true); // 开启动态内容翻译
    if (!nodes.length) return { count: 0 };
    await LP.translateNodes(nodes);
    return { count: nodes.length };
  };

  LP.restorePage = function () {
    LP.setDynamicEnabled(false);
    LP.translatedList.forEach(function (item) {
      if (item.node.isConnected) item.node.nodeValue = item.orig;
    });
    LP.translatedList = [];
    LP.doneTextNodes = new WeakSet();
  };

  // ---------------------------------------------------------------- 消息监听

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || !msg.type) return false;

    if (msg.type === 'LP_TRANSLATE_PAGE') {
      LP.translateWholePage()
        .then(function (r) { sendResponse(r); })
        .catch(function (e) { sendResponse({ error: e.message }); });
      return true;
    }
    if (msg.type === 'LP_RESTORE') {
      LP.restorePage();
      sendResponse({ ok: true });
      return false;
    }
    if (msg.type === 'LP_UPDATE_SETTINGS') {
      applySettings(msg.settings || {});
      sendResponse({ ok: true });
      return false;
    }
    if (msg.type === 'LP_GET_STATUS') {
      sendResponse({ translated: LP.translatedList.length > 0 });
      return false;
    }
    return false;
  });

  // ---------------------------------------------------------------- 初始化

  loadSettings().then(function () {
    if (document.body) {
      LP.initHover();
      LP.initSelection();
      LP.initDynamic();
    } else {
      document.addEventListener('DOMContentLoaded', function () {
        LP.initHover();
        LP.initSelection();
        LP.initDynamic();
      });
    }
  });
})(window.LinguaPage);
