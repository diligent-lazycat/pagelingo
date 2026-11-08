/**
 * 划词翻译：选中文本后自动翻译并展示悬浮框。
 * 点击空白处 / 重新选中 / 滚动时隐藏。
 */
window.LinguaPage = window.LinguaPage || {};

(function (LP) {
  const MIN_LEN = 1;
  const MAX_LEN = 5000;

  function settings() {
    return (LP.getSettings && LP.getSettings()) || {};
  }

  function onMouseUp(e) {
    if (!settings().selectionEnabled) return;
    // 排除在悬浮框内部的点击
    const tooltip = document.getElementById('lp-tooltip');
    if (tooltip && tooltip.contains(e.target)) return;

    setTimeout(function () {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      const text = sel.toString().trim();
      if (!text || text.length > MAX_LEN) return;

      const rect = sel.getRangeAt(0).getBoundingClientRect();
      const anchor = { x: rect.left, y: rect.top, bottom: rect.bottom };

      LP.tooltip.loading(anchor);
      translate(text, anchor);
    }, 10);
  }

  async function translate(text, anchor) {
    try {
      const s = settings();
      const terms = s.protectTerms ? LP.DEFAULT_TERMS : [];
      const out = await LP.protector.translateText(text, terms, s.sourceLang, s.targetLang);
      LP.tooltip.show(out, text, anchor);
    } catch (err) {
      LP.tooltip.show('翻译失败：' + err.message, text, anchor);
    }
  }

  function init() {
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('mousedown', function (e) {
      const tooltip = document.getElementById('lp-tooltip');
      if (tooltip && !tooltip.contains(e.target)) LP.tooltip.hide();
    });
    window.addEventListener('scroll', LP.tooltip.hide, { passive: true });
  }

  LP.initSelection = init;
})(window.LinguaPage);
