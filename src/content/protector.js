/**
 * 术语保护器：两级策略。
 *
 * 主策略（保语法）：把术语/URL/版本号替换成 {{0}} {{1}} 行内占位符，
 *   整句送翻译，译后校验占位符是否全部存活，再还原成原文。
 *   占位符格式经实测：MyMemory 会吞掉 \u0001 与 PUA(\uE000) 字符，
 *   但 {{0}} / [[0]] / <b0> 能存活，故选用 {{n}}（并对空格做容错匹配）。
 *
 * 兜底策略（保术语）：若某个引擎仍把占位符吃掉，该段改用「分段法」——
 *   只翻译术语之间的正文片段，术语永不进入翻译器，代价是句子可能略碎。
 *   宁可语法稍差，也不能把 GitHub 译成“0”。
 */
window.LinguaPage = window.LinguaPage || {};

(function (LP) {
  const HAS_WORD = /[A-Za-z\u00C0-\u024F\u0400-\u04FF\u0370-\u03FF\u0590-\u05FF\u0600-\u06FF\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF\u0E00-\u0E7F]/;

  // 匹配 {{0}} / {{ 0 }} / { {0} } 之类的容错形式
  const SLOT_RE = /\{\s*\{\s*(\d+)\s*\}\s*\}/g;

  function buildRegex(terms) {
    const patterns = [
      /https?:\/\/[^\s<>"']+/,                                        // URL
      /[\w.+-]+@[\w-]+\.[\w.-]+/,                                     // 邮箱
      /\b[0-9a-f]{7,40}\b/i,                                          // git SHA
      /\bv?\d+\.\d+(?:\.\d+)*(?:[-+][\w.]+)?\b/,                      // 版本号
      /\b\d+(?:[.,]\d+)?\s?(?:%|px|em|rem|ms|KB|MB|GB|TB|GHz|MHz)\b/  // 数字+单位
    ];

    // 术语按长度降序，避免子串抢先匹配（Git 先于 GitHub 命中）
    const sorted = (terms || []).slice().sort(function (a, b) { return b.length - a.length; });
    if (sorted.length) {
      const escaped = sorted.map(escapeRegExp).join('|');
      // 用前后断言代替 \b：Node.js、C++ 这类含符号的术语用 \b 会失配
      patterns.push(new RegExp('(?<![\\w-])(?:' + escaped + ')(?![\\w-])', 'gi'));
    }

    return new RegExp(patterns.map(function (p) { return '(' + p.source + ')'; }).join('|'), 'gi');
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ---------------------------------------------------------------- 主策略：行内占位

  /**
   * @returns {{text:string, tokens:string[]}} 占位后的文本与原始片段表
   */
  function protect(text, terms) {
    const tokens = [];
    const out = String(text == null ? '' : text).replace(buildRegex(terms), function (m) {
      tokens.push(m);
      return '{{' + (tokens.length - 1) + '}}';
    });
    return { text: out, tokens: tokens };
  }

  /**
   * 还原占位符。
   * @returns {{text:string, missing:number}} missing>0 表示有占位符被引擎吞掉
   */
  function restore(text, tokens) {
    if (!tokens || !tokens.length) return { text: String(text == null ? '' : text), missing: 0 };
    const seen = {};
    const out = String(text == null ? '' : text).replace(SLOT_RE, function (m, i) {
      const idx = Number(i);
      if (idx >= tokens.length) return m;
      seen[idx] = true;
      return tokens[idx];
    });
    let missing = 0;
    for (let i = 0; i < tokens.length; i++) if (!seen[i]) missing++;
    return { text: out, missing: missing };
  }

  // ---------------------------------------------------------------- 兜底策略：分段

  /**
   * @returns {Array<{keep:boolean, v:string, tr?:boolean}>}
   */
  function split(text, terms) {
    const src = String(text == null ? '' : text);
    if (!src) return [{ keep: false, v: '', tr: false }];

    const re = buildRegex(terms);
    const segs = [];
    let last = 0;
    let m;

    re.lastIndex = 0;
    while ((m = re.exec(src)) !== null) {
      const hit = m[0];
      if (!hit) { re.lastIndex++; continue; }
      if (m.index > last) segs.push({ keep: false, v: src.slice(last, m.index) });
      segs.push({ keep: true, v: hit });
      last = m.index + hit.length;
    }
    if (last < src.length) segs.push({ keep: false, v: src.slice(last) });
    if (!segs.length) segs.push({ keep: false, v: src });

    const out = [];
    for (const s of segs) {
      if (!s.keep) {
        const prev = out[out.length - 1];
        if (prev && !prev.keep) { prev.v += s.v; continue; }
      }
      out.push(s);
    }
    for (const s of out) if (!s.keep) s.tr = HAS_WORD.test(s.v);
    return out;
  }

  function planBatch(texts, terms) {
    const queue = [];
    const plans = texts.map(function (t) {
      const segs = split(t, terms);
      segs.forEach(function (s) {
        if (!s.keep && s.tr) { s.slot = queue.length; queue.push(s.v); }
      });
      return segs;
    });
    return { plans: plans, queue: queue };
  }

  function assemble(plans, results) {
    return plans.map(function (segs) {
      return segs.map(function (s) {
        if (s.keep || !s.tr) return s.v;
        const t = results && results[s.slot];
        return (typeof t === 'string' && t) ? t : s.v;
      }).join('');
    });
  }

  // ---------------------------------------------------------------- 单段：主策略 + 兜底

  async function translateText(text, terms, sl, tl) {
    const src = String(text == null ? '' : text);
    if (!HAS_WORD.test(src)) return src;

    const p = protect(src, terms);
    const r1 = await LP.translateTexts([p.text], sl, tl);
    const back = restore(r1[0], p.tokens);
    if (!back.missing) return back.text;

    // 占位符被吞 → 降级为分段翻译
    const planned = planBatch([src], terms);
    if (!planned.queue.length) return src;
    const r2 = await LP.translateTexts(planned.queue, sl, tl);
    return assemble(planned.plans, r2)[0];
  }

  LP.protector = {
    protect: protect,
    restore: restore,
    split: split,
    planBatch: planBatch,
    assemble: assemble,
    translateText: translateText
  };
})(window.LinguaPage);
