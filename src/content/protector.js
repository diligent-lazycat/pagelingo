/**
 * 占位保护器：翻译前把 URL、邮箱、哈希、版本号、专业术语替换为占位符，
 * 翻译后原样还原，避免这些内容被误译。
 */
window.LinguaPage = window.LinguaPage || {};

(function (LP) {
  const PREFIX = '\u0001'; // 控制字符，几乎不会出现在正常文本中

  // 动态构造术语正则：词边界 + 不区分大小写
  function buildRegex(terms) {
    const patterns = [
      /https?:\/\/[^\s<>"']+/,          // URL
      /[\w.+-]+@[\w-]+\.[\w.-]+/,       // 邮箱
      /\b[0-9a-f]{7,40}\b/i,            // git SHA
      /\bv?\d+\.\d+(?:\.\d+)*(?:[-+][\w.]+)?\b/, // 版本号
      /\b\d+(?:[.,]\d+)?\s?(?:%|px|em|rem|ms|s|KB|MB|GB|TB|GHz|MHz)\b/ // 数字+单位
    ];

    // 术语需按长度降序排列，避免子串优先匹配（如 Git 先于 GitHub）
    const sorted = terms.slice().sort(function (a, b) { return b.length - a.length; });
    if (sorted.length) {
      const escaped = sorted.map(escapeRegExp).join('|');
      patterns.push(new RegExp('\\b(?:' + escaped + ')\\b', 'gi'));
    }

    return new RegExp(patterns.map(function (p) { return '(' + p.source + ')'; }).join('|'), 'gi');
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // 保护：返回 { text, placeholders }
  function protect(text, terms) {
    const placeholders = [];
    const regex = buildRegex(terms || []);
    const out = String(text).replace(regex, function (m) {
      placeholders.push(m);
      return PREFIX + (placeholders.length - 1) + PREFIX;
    });
    return { text: out, placeholders: placeholders };
  }

  // 还原：把占位符换回原文
  function restore(text, placeholders) {
    if (!placeholders || !placeholders.length) return text;
    return String(text).replace(new RegExp(PREFIX + '(\\d+)' + PREFIX, 'g'), function (m, i) {
      return placeholders[Number(i)] || '';
    });
  }

  LP.protector = { protect: protect, restore: restore };
})(window.LinguaPage);
