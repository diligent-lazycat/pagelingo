/**
 * 悬浮翻译框：划词/悬停翻译的结果展示层。
 * 单例，全局复用；自动定位并吸附在视口内。
 */
window.LinguaPage = window.LinguaPage || {};

(function (LP) {
  let box = null;
  let styleInjected = false;

  function ensureStyle() {
    if (styleInjected) return;
    styleInjected = true;
    const css = [
      '#lp-tooltip{position:fixed;z-index:2147483647;max-width:420px;',
      'background:#fff;border:1px solid #e2e2e2;border-radius:12px;',
      'box-shadow:0 6px 24px rgba(0,0,0,.16);padding:12px 14px;',
      'font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;',
      'color:#1f2328;display:none;box-sizing:border-box;}',
      '#lp-tooltip .lp-head{display:flex;align-items:center;justify-content:space-between;',
      'margin-bottom:6px;font-size:12px;color:#888;}',
      '#lp-tooltip .lp-origin{color:#666;font-size:12px;margin-top:6px;',
      'padding-top:6px;border-top:1px dashed #eee;word-break:break-all;}',
      '#lp-tooltip .lp-btn{border:0;background:#eef1f5;color:#333;border-radius:6px;',
      'padding:2px 8px;font-size:12px;cursor:pointer;margin-left:6px;}',
      '#lp-tooltip .lp-btn:hover{background:#dfe4ea;}',
      '#lp-tooltip .lp-copy{color:#2563eb;}'
    ].join('');
    const st = document.createElement('style');
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  function ensureBox() {
    ensureStyle();
    if (box && box.isConnected) return box;
    box = document.createElement('div');
    box.id = 'lp-tooltip';
    box.innerHTML =
      '<div class="lp-head"><span>译 · PageLingo</span>' +
      '<span><button class="lp-btn lp-copy" data-lp="copy">复制</button>' +
      '<button class="lp-btn" data-lp="close">×</button></span></div>' +
      '<div data-lp="trans"></div>' +
      '<div class="lp-origin" data-lp="origin"></div>';
    document.body.appendChild(box);

    box.querySelector('[data-lp="close"]').addEventListener('click', hide);
    box.querySelector('[data-lp="copy"]').addEventListener('click', function () {
      const t = box.querySelector('[data-lp="trans"]').textContent;
      copyText(t);
    });
    return box;
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () { fallbackCopy(text); });
    } else {
      fallbackCopy(text);
    }
  }
  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    ta.remove();
  }

  // 展示：anchor 为 {x, y, bottom} 定位参考，origin 为原文
  function show(translated, origin, anchor) {
    const b = ensureBox();
    b.querySelector('[data-lp="trans"]').textContent = translated;
    const originEl = b.querySelector('[data-lp="origin"]');
    if (origin) {
      originEl.textContent = origin;
      originEl.style.display = '';
    } else {
      originEl.style.display = 'none';
    }

    b.style.display = 'block';
    position(b, anchor);
  }

  function position(b, anchor) {
    const pad = 10;
    const bw = b.offsetWidth || 420;
    const bh = b.offsetHeight || 80;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = anchor ? anchor.x : (vw - bw) / 2;
    let top = anchor ? (anchor.bottom || anchor.y) + pad : vh / 2 - bh / 2;

    // 水平吸附
    if (left + bw > vw - pad) left = vw - bw - pad;
    if (left < pad) left = pad;
    // 垂直吸附：下方放不下则放到锚点上方
    if (top + bh > vh - pad) {
      top = (anchor && anchor.y ? anchor.y - bh - pad : vh - bh - pad);
    }
    if (top < pad) top = pad;

    b.style.left = left + 'px';
    b.style.top = top + 'px';
  }

  function hide() {
    if (box) box.style.display = 'none';
  }

  function loading(anchor) {
    const b = ensureBox();
    b.querySelector('[data-lp="trans"]').textContent = '翻译中…';
    b.querySelector('[data-lp="origin"]').style.display = 'none';
    b.style.display = 'block';
    position(b, anchor);
    return b;
  }

  LP.tooltip = { show: show, hide: hide, loading: loading };
})(window.LinguaPage);
