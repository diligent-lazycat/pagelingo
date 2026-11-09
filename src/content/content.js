/**
 * 内容脚本入口：串联设置、翻译请求、全页翻译、还原与消息监听。
 * 是唯一与 popup 通信的模块。
 */
window.LinguaPage = window.LinguaPage || {};

(function (LP) {
  // 重复注入保护：service worker 发现页面没有脚本时会补注入一次
  // （典型场景：扩展安装/重载前就打开的标签页），避免事件被重复绑定
  if (LP.__booted) return;
  LP.__booted = true;

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
    // 注意：动态翻译的开关只由「翻译本页 / 还原原文」控制。
    // 改设置时不能动它，否则用户翻译完再调一次语言会把动态翻译关掉（旧版 bug）。
  }

  // ---------------------------------------------------------------- 节点判定

  // 键盘快捷键提示：修饰键组合（option shift r）或按键序列（g then d）
  const SHORTCUT_RE = /^(?:(?:option|shift|cmd|command|ctrl|control|alt|fn|⌘|⇧|⌥|⌃)\s+)*[a-z0-9]$|^[a-z0-9]\s+(?:then|and)\s+[a-z0-9]$/i;

  // 判断文本节点是否应跳过（祖先含代码/链接/悬浮框等）
  LP.isSkippedTextNode = function (node) {
    const skipLinks = LP.getSettings().skipLinks;
    let el = node.parentElement;
    while (el) {
      if (el.id === 'lp-tooltip' || el.id === 'lp-toast') return true;
      if (skipLinks && el.tagName === 'A') return true;
      if (LP.classifier.shouldSkipElement(el)) return true;
      el = el.parentElement;
    }
    const text = (node.nodeValue || '').trim();
    // 文本本身像代码/命令/版本号时也跳过（旧版定义了 isCodeLike 却从未调用）
    if (LP.classifier.isCodeLike(text)) return true;
    // 键盘快捷键提示跳过：GitHub 的「g then d」「option shift r」译出来是
    // 「g然后d」，既畸形又破坏按键提示，实测这两类必须原样保留
    if (SHORTCUT_RE.test(text)) return true;
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
        customEndpoint: s.customEndpoint,
        deeplKey: s.deeplKey
      }, function (resp) {
        if (chrome.runtime.lastError) {
          resolve({ error: chrome.runtime.lastError.message });
        } else {
          if (resp && resp.engine) LP.lastEngine = resp.engine;
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

    // 第一轮：行内占位（{{0}}），整句翻译，语法完整
    const prot = texts.map(function (t) { return LP.protector.protect(t, terms); });
    const r1 = await LP.translateTexts(prot.map(function (p) { return p.text; }));
    const finals = prot.map(function (p, i) { return LP.protector.restore(r1[i], p.tokens); });

    // 第二轮：占位符被引擎吞掉的节点，降级为分段法（术语绝不进翻译器）
    const fallbackIdx = [];
    finals.forEach(function (r, i) { if (r.missing) fallbackIdx.push(i); });
    if (fallbackIdx.length) {
      const planned = LP.protector.planBatch(fallbackIdx.map(function (i) { return texts[i]; }), terms);
      const r2 = planned.queue.length ? await LP.translateTexts(planned.queue) : [];
      const fixed = LP.protector.assemble(planned.plans, r2);
      fallbackIdx.forEach(function (i, k) { finals[i] = { text: fixed[k], missing: 0 }; });
    }

    valid.forEach(function (node, i) {
      const w = ws[i];
      // 记录原文以便还原
      LP.translatedList.push({ node: node, orig: node.nodeValue });
      node.nodeValue = w.lead + finals[i].text + w.tail;
      LP.doneTextNodes.add(node);
    });
  };

  // ---------------------------------------------------------------- 全页翻译 / 还原

  // ---------------------------------------------------------------- 页内提示
  // 用右键菜单或快捷键触发时没有面板可看，所以在页面右下角给一条状态提示。
  // 挂在 <html> 而不是 <body> 上：既不进入全页翻译的文本遍历，也不会触发动态观察。
  LP.toast = function (text, kind, holdMs) {
    let el = document.getElementById('lp-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'lp-toast';
      el.setAttribute('data-lp', 'ui');
      el.style.cssText = [
        'position:fixed', 'right:18px', 'bottom:18px', 'z-index:2147483647',
        'max-width:360px', 'padding:10px 14px', 'border-radius:10px',
        'font:13px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif',
        'color:#fff', 'background:#2563eb', 'box-shadow:0 6px 24px rgba(0,0,0,.25)',
        'pointer-events:none', 'opacity:0', 'transition:opacity .18s ease'
      ].join(';');
      document.documentElement.appendChild(el);
    }
    el.style.background = kind === 'error' ? '#dc2626'
      : kind === 'ok' ? '#16a34a'
      : '#2563eb';
    el.textContent = text;
    el.style.opacity = '1';
    clearTimeout(el.__lpTimer);
    el.__lpTimer = setTimeout(function () { el.style.opacity = '0'; }, holdMs || 2600);
    return el;
  };

  LP.translateWholePage = async function () {
    const nodes = LP.collectTextNodes(document.body, LP.doneTextNodes);
    LP.setDynamicEnabled(true); // 开启动态内容翻译
    if (!nodes.length) {
      LP.toast('本页没有可翻译的文本（可能已是中文，或全部被跳过）', 'error');
      return { count: 0 };
    }
    LP.toast('正在翻译 ' + nodes.length + ' 段文本…');
    try {
      await LP.translateNodes(nodes);
    } catch (e) {
      LP.toast('翻译失败：' + e.message, 'error', 6000);
      throw e;
    }
    const engine = LP.lastEngine || '';
    LP.toast('翻译完成，共 ' + nodes.length + ' 段' + (engine ? '（' + engine + '）' : ''), 'ok');
    return { count: nodes.length, engine: engine };
  };

  LP.restorePage = function () {
    LP.setDynamicEnabled(false);
    LP.translatedList.forEach(function (item) {
      if (item.node.isConnected) item.node.nodeValue = item.orig;
    });
    const n = LP.translatedList.length;
    LP.translatedList = [];
    LP.doneTextNodes = new WeakSet();
    if (LP.toast) LP.toast('已还原原文' + (n ? '（' + n + ' 段）' : ''), 'ok');
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
