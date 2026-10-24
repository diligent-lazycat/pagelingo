/**
 * 动态内容监听：用 MutationObserver 识别并翻译动态加载的内容。
 * 仅在用户开启「全页翻译」后生效（LP.dynamicEnabled），
 * 新增节点先收集、防抖后统一翻译，避免频繁请求。
 */
window.LinguaPage = window.LinguaPage || {};

(function (LP) {
  let observer = null;
  let pending = [];
  let timer = null;
  const FLUSH_DELAY = 300;

  function enabled() {
    return LP.dynamicEnabled === true;
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(flush, FLUSH_DELAY);
  }

  function flush() {
    timer = null;
    if (!enabled()) { pending = []; return; }
    const nodes = pending;
    pending = [];
    if (nodes.length && LP.translateNodes) LP.translateNodes(nodes);
  }

  function onMutations(muts) {
    if (!enabled()) return;
    for (const m of muts) {
      if (m.type !== 'childList') continue;
      for (const n of m.addedNodes) {
        if (n.nodeType === 1) {
          // 新插入的子树：跳过代码块，收集其中的文本节点
          if (LP.classifier.shouldSkipElement(n)) continue;
          const found = LP.collectTextNodes ? LP.collectTextNodes(n, LP.doneTextNodes) : [];
          for (const t of found) pending.push(t);
        } else if (n.nodeType === 3) {
          if (LP.isSkippedTextNode && LP.isSkippedTextNode(n)) continue;
          if (LP.doneTextNodes && LP.doneTextNodes.has(n)) continue;
          if ((n.nodeValue || '').trim()) pending.push(n);
        }
      }
    }
    if (pending.length) schedule();
  }

  function init() {
    if (observer || !document.body) return;
    observer = new MutationObserver(onMutations);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  LP.initDynamic = init;
  LP.setDynamicEnabled = function (v) { LP.dynamicEnabled = !!v; };
})(window.LinguaPage);
