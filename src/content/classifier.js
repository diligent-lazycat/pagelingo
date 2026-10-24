/**
 * DOM 节点分类器：判断哪些元素/文本需要跳过，避免误译。
 * 针对 GitHub 场景重点处理代码块、命令、行内代码、链接等。
 */
window.LinguaPage = window.LinguaPage || {};

(function (LP) {
  // 整块跳过：这些标签内的文字一律不翻译
  const SKIP_TAGS = {
    SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1,
    CODE: 1, PRE: 1, KBD: 1, SAMP: 1, VAR: 1, TT: 1,
    TEXTAREA: 1, INPUT: 1, SELECT: 1, OPTION: 1, BUTTON: 1,
    IFRAME: 1, CANVAS: 1, SVG: 1, MATH: 1, NOBR: 1, ABBR: 1
  };

  // class / id / role 中包含这些关键词的，判定为代码相关，跳过
  const CODE_HINT = /\b(hljs|highlight|language-|blob-code|token|katex|mathjax|monaco|codemirror|command|cmd|terminal|shell|linenumber|line-number|diff|signature)\b/i;

  function isElement(node) {
    return node && node.nodeType === 1;
  }

  // 判断一个元素是否应整体跳过（不翻译其内部文字）
  function shouldSkipElement(el) {
    if (!isElement(el)) return false;

    if (SKIP_TAGS[el.tagName]) return true;
    if (el.isContentEditable) return true;

    // 尊重网页自身标注：translate="no" 或 data-lp-skip
    if (el.hasAttribute && el.getAttribute('translate') === 'no') return true;
    if (el.hasAttribute && el.hasAttribute('data-lp-skip')) return true;

    const cls = typeof el.className === 'string' ? el.className : '';
    const id = el.id || '';
    const role = el.getAttribute ? (el.getAttribute('role') || '') : '';
    if (CODE_HINT.test(cls + ' ' + id + ' ' + role)) return true;

    return false;
  }

  // 判断一段文本是否像代码（路径 / 哈希 / 版本号 / 命令等）
  function isCodeLike(text) {
    const t = String(text || '').trim();
    if (!t) return false;

    // git SHA（7-40 位十六进制）
    if (/^[0-9a-f]{7,40}$/i.test(t)) return true;
    // 语义化版本号 v1.2.3 / 1.2.3-rc.1
    if (/^v?\d+\.\d+(\.\d+)*([-+][\w.-]+)?$/.test(t)) return true;
    // 仓库/路径形式 owner/repo、a/b/c、./path、/path
    if (/^[./@]?[\w.-]+(\/[\w.-]+)+$/.test(t)) return true;
    // shell 命令（以 $ 或 # 开头）
    if (/^[$#>]\s*\S/.test(t)) return true;
    // 纯大写缩写或含下划线的标识符（常量/变量名）
    if (/^[A-Z][A-Z0-9_]{1,}$/.test(t)) return true;

    return false;
  }

  LP.classifier = {
    SKIP_TAGS: SKIP_TAGS,
    shouldSkipElement: shouldSkipElement,
    isCodeLike: isCodeLike
  };
})(window.LinguaPage);
