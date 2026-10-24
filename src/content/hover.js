/**
 * 段落悬停翻译：鼠标停留在文本块上（默认 500ms）自动翻译并展示。
 * 采用事件委托 + 防抖 + 缓存，减少 API 调用。
 */
window.LinguaPage = window.LinguaPage || {};

(function (LP) {
  const HOVER_TAGS = { P: 1, LI: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, TD: 1, DT: 1, DD: 1, FIGCAPTION: 1, BLOCKQUOTE: 1 };
  const DELAY = 500;
  const MIN_LEN = 4;

  let timer = null;
  let cache = {}; // key -> 译文

  function settings() {
    return (LP.getSettings && LP.getSettings()) || {};
  }

  function cacheKey(text) {
    const s = settings();
    return s.sourceLang + '|' + s.targetLang + '|' + text;
  }

  function onEnter(e) {
    if (!settings().hoverEnabled) return;
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    if (!HOVER_TAGS[el.tagName]) return;
    if (LP.classifier.shouldSkipElement(el)) return;

    const text = (el.textContent || '').trim();
    if (!text || text.length < MIN_LEN || text.length > 2000) return;

    clearTimeout(timer);
    timer = setTimeout(function () { doTranslate(el, text, e); }, DELAY);
  }

  function onLeave() {
    clearTimeout(timer);
    // 不立即隐藏，用户移入悬浮框时可阅读；由全局点击/滚动时隐藏
  }

  async function doTranslate(el, text, e) {
    const key = cacheKey(text);
    const anchor = { x: e.clientX, y: e.clientY, bottom: el.getBoundingClientRect().bottom + window.scrollY - window.scrollY };

    if (cache[key]) {
      LP.tooltip.show(cache[key], text, { x: e.clientX, y: e.clientY, bottom: e.clientY });
      return;
    }

    LP.tooltip.loading({ x: e.clientX, y: e.clientY, bottom: e.clientY });
    try {
      const s = settings();
      const terms = s.protectTerms ? LP.DEFAULT_TERMS : [];
      const p = LP.protector.protect(text, terms);
      const result = await LP.translateTexts([p.text], s.sourceLang, s.targetLang);
      const out = LP.protector.restore(result[0], p.placeholders);
      cache[key] = out;
      LP.tooltip.show(out, text, { x: e.clientX, y: e.clientY, bottom: e.clientY });
    } catch (err) {
      LP.tooltip.show('翻译失败：' + err.message, text, { x: e.clientX, y: e.clientY, bottom: e.clientY });
    }
  }

  function init() {
    document.addEventListener('mouseover', onEnter, true);
    document.addEventListener('mouseout', onLeave, true);
  }

  LP.initHover = init;
})(window.LinguaPage);
