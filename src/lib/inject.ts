import {
  AD_DOMAINS,
  AD_SELECTORS,
  GAMBLING_DOMAINS,
  GAMBLING_HOST_KEYWORDS,
  GAMBLING_SELECTORS,
  POPUP_SELECTORS,
  SITE_AD_SELECTORS,
} from '@/filters';
import type { ShieldPrefs } from '@/state/settings';
import type { SiteThemes } from '@/state/site-themes';

export interface InjectConfig {
  defaults: ShieldPrefs;
  sites: Record<string, Partial<ShieldPrefs>>;
  /** Phần tử tự ẩn theo trang (bộ chọn CSS) */
  hides: Record<string, string[]>;
  /** Phát nền: trang luôn tưởng mình đang hiển thị nên không tự dừng video khi chuyển app */
  bgPlay: boolean;
}

/**
 * Script chạy trước khi trang tải (injectedJavaScriptBeforeContentLoaded).
 * - Ẩn quảng cáo/cờ bạc/pop-up bằng CSS và đếm số phần tử bị ẩn.
 * - Chặn window.open tự động (pop-up).
 * - Chế độ tối kiểu Dark Reader (đảo màu + giữ nguyên ảnh/video), bỏ qua trang vốn đã tối.
 * - window.__ryx.update(cfg) để áp dụng thay đổi ngay mà không cần tải lại.
 */
export function buildInjectedScript(cfg: InjectConfig, themes: SiteThemes = {}): string {
  const data = JSON.stringify({
    cfg,
    themes,
    sel: { ads: AD_SELECTORS, gambling: GAMBLING_SELECTORS, popups: POPUP_SELECTORS },
    site: SITE_AD_SELECTORS,
    hosts: { ads: AD_DOMAINS, gambling: GAMBLING_DOMAINS, gkw: GAMBLING_HOST_KEYWORDS },
  });
  return `(function(){
try {
if (window.__ryx) { return; }
var D = ${data};
var CFG = D.cfg;
var root = document.documentElement;
function prefs(){
  var h = (location.hostname || '').replace(/^www\\./, '');
  var o = CFG.sites[h] || {};
  var p = {}; for (var k in CFG.defaults) { p[k] = (k in o) ? o[k] : CFG.defaults[k]; }
  return p;
}
function valid(list){
  var out = [];
  for (var i = 0; i < list.length; i++) { try { document.createDocumentFragment().querySelector(list[i]); out.push(list[i]); } catch (e) {} }
  return out.join(',');
}
var HKEY = (location.hostname || '').replace(/^www\\./, '');
var SITE_SEL = D.site[HKEY] || [];
var SEL = { ads: valid(D.sel.ads.concat(SITE_SEL)), gambling: valid(D.sel.gambling), popups: valid(D.sel.popups) };
/* Tên miền quảng cáo/cờ bạc: dùng để chặn script & iframe ngay lúc trang định chèn vào */
var AD_H = {}, GB_H = {};
D.hosts.ads.forEach(function(h){ AD_H[h] = 1; });
D.hosts.gambling.forEach(function(h){ GB_H[h] = 1; });
function inSet(host, set){ var h = host; while (h && h.indexOf('.') > 0) { if (set[h]) return true; h = h.slice(h.indexOf('.') + 1); } return false; }
function hostKind(u){
  var s = String(u || ''); var i = s.indexOf('//');
  if (i < 0 || i > 6) return null;
  var h = '';
  for (var j = i + 2; j < s.length; j++) { var c = s.charAt(j); if (c === '/' || c === '?' || c === '#' || c === ':') break; h += c; }
  h = h.toLowerCase(); if (!h) return null;
  if (inSet(h, GB_H)) return 'gambling';
  for (var i = 0; i < D.hosts.gkw.length; i++) if (h.indexOf(D.hosts.gkw[i]) >= 0) return 'gambling';
  if (inSet(h, AD_H)) return 'ads';
  return null;
}
var counts = { ads: 0, gambling: 0, popups: 0 };
var P = prefs();

function post(){
  try { window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ryx:counts', url: location.href, counts: counts })); } catch (e) {}
}
var postTimer = null;
function schedulePost(){ if (postTimer) return; postTimer = setTimeout(function(){ postTimer = null; post(); }, 400); }

function styleEl(id){
  var s = document.getElementById(id);
  if (!s) { s = document.createElement('style'); s.id = id; (document.head || root).appendChild(s); }
  return s;
}
function applyHide(){
  var css = '';
  ['ads','gambling','popups'].forEach(function(k){
    if (P[k] && SEL[k]) css += SEL[k] + '{display:none!important;visibility:hidden!important;}';
  });
  var mine = valid((CFG.hides || {})[HKEY] || []);
  if (mine) css += mine + '{display:none!important;}';
  styleEl('ryx-hide').textContent = css;
}

function scan(){
  var changed = false;
  ['ads','gambling','popups'].forEach(function(k){
    if (!P[k] || !SEL[k]) return;
    var els; try { els = document.querySelectorAll(SEL[k]); } catch (e) { return; }
    for (var i = 0; i < els.length; i++) {
      if (!els[i].__ryxSeen) {
        els[i].__ryxSeen = 1; counts[k]++; changed = true;
        /* Banner video: ẩn luôn khung bọc (link/banner) để không chừa ô trống */
        if (els[i].tagName === 'VIDEO') {
          var box = els[i].closest('a,[class*="banner"],[class*="catfish"],[id*="catfish"],[class*="ads"]');
          if (box) box.style.setProperty('display', 'none', 'important');
        }
      }
    }
  });
  if (changed) schedulePost();
}
var scanTimer = null;
function scheduleScan(){ if (scanTimer) return; scanTimer = setTimeout(function(){ scanTimer = null; scan(); }, 500); }

/* Pop-up: chặn window.open không do người dùng bấm */
var lastTap = 0;
document.addEventListener('click', function(){ lastTap = Date.now(); }, true);
document.addEventListener('touchend', function(){ lastTap = Date.now(); }, true);
var nativeOpen = window.open;
window.open = function(){
  if (P.popups && Date.now() - lastTap > 1000) { counts.popups++; schedulePost(); return null; }
  return nativeOpen.apply(window, arguments);
};

/* Chặn script/iframe quảng cáo ngay lúc trang chèn vào (trước khi tải) */
function blockedNode(n){
  if (!n || n.nodeType !== 1) return null;
  var tag = n.tagName;
  if (tag !== 'SCRIPT' && tag !== 'IFRAME') return null;
  var kind = hostKind(n.src || n.getAttribute('src'));
  if (!kind) return null;
  if (kind === 'gambling' ? !P.gambling : !P.ads) return null;
  return kind;
}
function guard(orig){
  return function(n){
    var kind = blockedNode(n);
    if (kind) { counts[kind]++; schedulePost(); return n; }
    return orig.apply(this, arguments);
  };
}
try {
  Node.prototype.appendChild = guard(Node.prototype.appendChild);
  Node.prototype.insertBefore = guard(Node.prototype.insertBefore);
} catch (e) {}

/* Chế độ tối */
var DARK_CSS = 'html{background:#fff!important;filter:invert(0.9) hue-rotate(180deg)!important;}' +
  'img,video,picture,canvas,iframe,embed,object,svg image,[style*="background-image"]{filter:invert(1) hue-rotate(180deg)!important;}';
var HOST = (location.hostname || '').replace(/^www\\./, '');
var known = D.themes ? D.themes[HOST] : undefined;
/* Đã biết trang này sáng/tối từ lần trước → áp dụng đúng ngay, không chớp */
var pageIsDark = known === 1 ? true : (known === 0 ? false : null);
function luminance(c){
  var m = /rgba?\\(([^)]+)\\)/.exec(c || ''); if (!m) return null;
  var p = m[1].split(',').map(parseFloat);
  if (p.length > 3 && p[3] < 0.1) return null;
  return (0.2126*p[0] + 0.7152*p[1] + 0.0722*p[2]) / 255;
}
function detectDark(){
  var s = document.getElementById('ryx-dark'); var prev = s ? s.textContent : '';
  if (s) s.textContent = '';
  var l = luminance(getComputedStyle(document.body || root).backgroundColor);
  if (l === null) l = luminance(getComputedStyle(root).backgroundColor);
  if (s) s.textContent = prev;
  var meta = document.querySelector('meta[name="color-scheme"]');
  var metaDark = !!meta && /^\\s*dark\\s*$/.test(meta.content);
  if (l === null && !metaDark) return false; /* chưa đo được, giữ nguyên */
  pageIsDark = metaDark || l < 0.35;
  return true;
}
function applyDark(){
  styleEl('ryx-dark').textContent = (P.dark && pageIsDark !== true) ? DARK_CSS : '';
}

function applyAll(){ applyHide(); applyDark(); scan(); }

applyHide(); applyDark();
/* Đo màu nền sớm, ngay khi phần thân trang xuất hiện (không đợi DOMContentLoaded) */
var earlyDone = false;
function earlyDetect(){
  if (earlyDone || !document.body) return;
  earlyDone = true;
  if (detectDark()) applyDark();
}
new MutationObserver(function(){ earlyDetect(); scheduleScan(); }).observe(root, { childList: true, subtree: true });
function send(m){ try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) {} }
/* Đo video chờ tải: từ lúc bắt đầu tải / bị khựng (waiting) tới lúc phát được. Chỉ báo khi > 2 giây. */
function vsrc(v){ return String(v.currentSrc || v.src || '').slice(0, 200); }
function vstart(e){ var v = e.target; if (v && v.tagName === 'VIDEO' && !v.__ryxT) { v.__ryxT = Date.now(); v.__ryxKind = e.type; } }
function vplay(e){
  var v = e.target; if (!v || v.tagName !== 'VIDEO' || !v.__ryxT) return;
  var ms = Date.now() - v.__ryxT; var kind = v.__ryxKind; v.__ryxT = 0;
  if (ms > 2000) send({ type: 'ryx:video', ms: ms, kind: kind, src: vsrc(v), host: HOST });
}
document.addEventListener('loadstart', vstart, true);
document.addEventListener('waiting', vstart, true);
document.addEventListener('playing', vplay, true);
document.addEventListener('DOMContentLoaded', function(){
  earlyDone = true;
  detectDark(); applyAll(); post();
  /* Nội dung đã dùng được: báo app cho thanh tiến trình xong luôn */
  send({ type: 'ryx:ready', url: location.href });
  try { reportChapter(); } catch (e) {}
  if (pageIsDark !== null) send({ type: 'ryx:theme', host: HOST, dark: pageIsDark });
});
window.addEventListener('load', scan);


/* Nhấn giữ ảnh/video → app hiện menu (Lưu vào Ảnh, Sao chép link…) */
/* Chữ trong link không bị iOS tô chọn khi nhấn giữ (để chỉ hiện menu của Ryx); giữ rồi kéo thì Ryx tự tô */
styleEl('ryx-lp').textContent = 'img,video,a{-webkit-touch-callout:none!important;}video,[data-ryx-v],[data-ryx-v] *{-webkit-tap-highlight-color:transparent!important;-webkit-touch-callout:none!important;-webkit-user-select:none!important;user-select:none!important;}a,a *{-webkit-user-select:none!important;user-select:none!important;}a.ryx-sel,a.ryx-sel *{-webkit-user-select:text!important;user-select:text!important;}';
var lp = null, lpX = 0, lpY = 0, lpFired = 0, lpArm = null, lpSel = null;
function mediaAt(t){
  if (!t || !t.closest) return null;
  var v = t.closest('video'); if (v) return v;
  var im = t.closest('img'); if (im) return im;
  /* Lớp nút phủ lên video của trình phát */
  var box = t.closest('[class*="player"],[id*="player"]');
  if (box) { var vv = box.querySelector('video'); if (vv) return vv; }
  return null;
}
/* Video lớn nhất nằm dưới ngón tay (kể cả khi bị lớp nút của trình phát phủ lên) */
function videoAt(x, y){
  var vs = document.getElementsByTagName('video'), best = null, area = 0;
  for (var i = 0; i < vs.length; i++) {
    var r = vs[i].getBoundingClientRect();
    if (r.width < 120 || x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
    if (r.width * r.height > area) { area = r.width * r.height; best = vs[i]; }
  }
  return best;
}
/* Khung trình phát quanh video: tắt lớp tô xám / chọn chữ của iOS khi nhấn giữ (lớp phủ nút của trình phát
   mới là thứ bị tô, không phải thẻ <video>) — đánh dấu video + vài lớp cha có kích thước gần bằng video */
function markPlayer(v){
  try {
    var r = v.getBoundingClientRect(), area = Math.max(1, r.width * r.height), n = v;
    for (var i = 0; i < 5 && n && n !== document.body && n !== root; i++) {
      var q = n.getBoundingClientRect();
      if (i > 0 && q.width * q.height > area * 2.5) break;
      if (!n.hasAttribute('data-ryx-v')) n.setAttribute('data-ryx-v', '');
      n = n.parentElement;
    }
  } catch (e) {}
}
['loadstart', 'loadedmetadata', 'playing'].forEach(function(t){ document.addEventListener(t, function(e){ if (e.target && e.target.tagName === 'VIDEO') markPlayer(e.target); }, true); });
function inPlayer(t){ return !!(t && t.closest && t.closest('[data-ryx-v]')); }
document.addEventListener('selectstart', function(e){ if (inPlayer(e.target)) e.preventDefault(); }, true);
document.addEventListener('contextmenu', function(e){ if (inPlayer(e.target)) e.preventDefault(); }, true);
document.addEventListener('touchstart', function(e){
  if (!e.touches || e.touches.length !== 1) return;
  var x = e.touches[0].clientX, y = e.touches[0].clientY;
  var vv = videoAt(x, y); if (vv) markPlayer(vv);
  var m = vv || mediaAt(e.target);
  var link = !m && e.target && e.target.closest ? e.target.closest('a[href]') : null;
  if (!m && !(link && /^https?:/i.test(link.href))) return;
  lpX = x; lpY = y;
  clearTimeout(lp);
  lp = setTimeout(function(){
    lp = null; lpFired = Date.now();
    if (!m) {
      lpArm = { link: link, x: lpX, y: lpY };
      send({ type: 'ryx:link', href: link.href, text: String(link.textContent || link.title || '').trim().slice(0, 120), url: location.href, x: lpX, y: lpY });
      return;
    }
    var isV = m.tagName === 'VIDEO';
    var so = isV && m.querySelector ? m.querySelector('source') : null;
    var src = isV ? (m.currentSrc || m.src || (so ? so.src : '')) : (m.currentSrc || m.src || '');
    var a = m.closest('a');
    if (isV) lpVideo = m;
    send({ type: 'ryx:media', pip: isV && pipSupported(m), kind: isV ? 'video' : 'image', src: String(src || ''), poster: isV ? String(m.poster || '') : '', link: a ? a.href : '', url: location.href, playing: isV && !m.paused, title: document.title, x: lpX, y: lpY });
  }, 550);
}, { passive: true, capture: true });
function lpCancel(e){
  if (!lp) return;
  if (e.type === 'touchmove' && e.touches && e.touches[0]) {
    if (Math.abs(e.touches[0].clientX - lpX) < 10 && Math.abs(e.touches[0].clientY - lpY) < 10) return;
  }
  clearTimeout(lp); lp = null;
}
document.addEventListener('touchmove', lpCancel, { passive: true, capture: true });
document.addEventListener('touchend', lpCancel, { passive: true, capture: true });
document.addEventListener('touchcancel', lpCancel, { passive: true, capture: true });
/* Giữ link → menu hiện; vẫn giữ tay rồi kéo quá ~20px → đóng menu và tô chữ từ chỗ đặt tay tới ngón tay */
function caretAt(x, y){ try { return document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null; } catch (e) { return null; } }
document.addEventListener('touchmove', function(e){
  if ((!lpArm && !lpSel) || !e.touches || !e.touches[0]) return;
  var t = e.touches[0];
  if (lpArm) {
    if (Math.abs(t.clientX - lpArm.x) + Math.abs(t.clientY - lpArm.y) < 20) { if (e.cancelable) e.preventDefault(); return; }
    lpSel = lpArm; lpArm = null;
    lpSel.link.classList.add('ryx-sel');
    send({ type: 'ryx:select' });
  }
  if (e.cancelable) e.preventDefault();
  var a = caretAt(lpSel.x, lpSel.y), b = caretAt(t.clientX, t.clientY);
  if (!a || !b) return;
  var fwd = a.compareBoundaryPoints(Range.START_TO_START, b) <= 0;
  var st = fwd ? a : b, en = fwd ? b : a, r = document.createRange();
  r.setStart(st.startContainer, st.startOffset); r.setEnd(en.startContainer, en.startOffset);
  var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
}, { passive: false, capture: true });
function lpRelease(){ lpArm = null; if (lpSel) { lastSelLink = lpSel.link; lpSel = null; } }
var lastSelLink = null;
document.addEventListener('touchend', lpRelease, { passive: true, capture: true });
document.addEventListener('touchcancel', lpRelease, { passive: true, capture: true });
/* Bỏ chọn xong thì link trở lại không tô được */
document.addEventListener('selectionchange', function(){
  if (lastSelLink && !lpSel && String(window.getSelection() || '') === '') { lastSelLink.classList.remove('ryx-sel'); lastSelLink = null; }
});
/* Sau khi nhấn giữ thì bỏ cú "bấm" đi kèm, để trang không mở link/quảng cáo */
document.addEventListener('click', function(e){ if (Date.now() - lpFired < 800) { e.preventDefault(); e.stopPropagation(); } }, true);

/* Đọc truyện: nhận ra trang chương, tìm link chương trước/sau, tải trước chương sau */
var CHAP_RE = /(?:chap|chuong|chapter)[-_\\/]?(\\d+(?:[.-]\\d+)?)/i;
function chapterInfo(){
  var path = location.pathname || '';
  var m = CHAP_RE.exec(path);
  if (!m) return null;
  var next = null, prev = null;
  var rn = document.querySelector('a[rel~="next"],link[rel~="next"]');
  var rp = document.querySelector('a[rel~="prev"],link[rel~="prev"]');
  if (rn && rn.href) next = rn.href;
  if (rp && rp.href) prev = rp.href;
  var links = document.querySelectorAll('a[href]');
  for (var i = 0; i < links.length && (!next || !prev); i++) {
    var a = links[i];
    var href = a.href || '';
    if (!href || href.indexOf('#') === href.length - 1 || href === location.href) continue;
    if (!CHAP_RE.test(href)) continue;
    var t = ((a.textContent || '') + ' ' + (a.title || '') + ' ' + (a.getAttribute('aria-label') || '') + ' ' + (typeof a.className === 'string' ? a.className : '')).toLowerCase();
    if (!next && /(sau|tiếp|kế|next)/.test(t)) next = href;
    else if (!prev && /(trước|truoc|prev|back)/.test(t)) prev = href;
  }
  var raw = (document.querySelector('h1') || {}).textContent || document.title || '';
  var title = raw.split(/ [-|–] /)[0].replace(CHAP_RE, '').replace(/(chương|chap|chapter)\\s*[\\d.]+/i, '').replace(/[\\s:-]+$/, '').trim();
  var series = location.hostname.replace(/^www\\./, '') + path.replace(/[-_\\/]?(?:chap|chuong|chapter)[-_\\/]?\\d+.*$/i, '');
  return { series: series, title: title || location.hostname, chapter: 'Chương ' + m[1].replace('-', '.'), url: location.href, next: next, prev: prev };
}
var prefetched = {};
function prefetchChapter(url){
  if (!url || prefetched[url]) return;
  prefetched[url] = 1;
  try {
    fetch(url, { credentials: 'include' }).then(function(r){ return r.text(); }).then(function(html){
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var imgs = doc.querySelectorAll('img'), n = 0;
      for (var i = 0; i < imgs.length && n < 10; i++) {
        var src = imgs[i].getAttribute('data-src') || imgs[i].getAttribute('data-original') || imgs[i].getAttribute('src');
        if (!src || src.indexOf('data:') === 0) continue;
        try { var im = new Image(); im.src = new URL(src, url).href; n++; } catch (e) {}
      }
    }).catch(function(){});
  } catch (e) {}
}
function reportChapter(){
  var c = chapterInfo();
  if (!c || (!c.next && !c.prev)) return;
  send({ type: 'ryx:chapter', series: c.series, title: c.title, chapter: c.chapter, url: c.url, next: c.next, prev: c.prev });
  /* Đợi trang hiện xong ảnh của chương này rồi mới tải trước chương sau */
  if (c.next) setTimeout(function(){ prefetchChapter(c.next); }, 4000);
}

/* Phát nền: nhiều trang tự dừng video khi thấy trang bị ẩn (chuyển app, tắt màn hình) */
if (CFG.bgPlay) {
  try {
    Object.defineProperty(document, 'hidden', { get: function(){ return false; }, configurable: true });
    Object.defineProperty(document, 'webkitHidden', { get: function(){ return false; }, configurable: true });
    Object.defineProperty(document, 'visibilityState', { get: function(){ return 'visible'; }, configurable: true });
    document.addEventListener('visibilitychange', function(e){ e.stopImmediatePropagation(); }, true);
    document.addEventListener('webkitvisibilitychange', function(e){ e.stopImmediatePropagation(); }, true);
  } catch (e) {}
}

/* Hình trong hình (PiP): bật từ menu nhấn giữ video của Ryx, không còn nút nổi đè lên video */
var lpVideo = null, pipTap = null;
function pipSupported(v){ return !!(v && (v.webkitSupportsPresentationMode && v.webkitSupportsPresentationMode('picture-in-picture'))); }
function pipToggle(v){
  var mode = v.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture';
  v.webkitSetPresentationMode(mode);
  return mode;
}
/* iOS có thể đòi một cú chạm thật: hiện nút "Chạm để mở PiP" giữa video trong 4 giây */
function pipFallback(v, why){
  if (pipTap) pipTap.remove();
  var r = v.getBoundingClientRect();
  pipTap = document.createElement('div');
  pipTap.setAttribute('role', 'button');
  pipTap.textContent = 'Chạm để mở Hình trong hình';
  pipTap.style.cssText = 'position:absolute;z-index:2147483647;padding:10px 16px;border-radius:22px;background:rgba(0,0,0,.7);color:#fff;font:600 14px -apple-system,system-ui;-webkit-backdrop-filter:blur(8px);';
  pipTap.style.top = (r.top + window.scrollY + r.height / 2 - 20) + 'px';
  pipTap.style.left = (r.left + window.scrollX + Math.max(8, r.width / 2 - 110)) + 'px';
  pipTap.addEventListener('click', function(e){
    e.preventDefault(); e.stopPropagation();
    try { pipToggle(v); send({ type: 'ryx:log', level: 'info', msg: 'Đã bật PiP bằng nút chạm', url: location.href }); }
    catch (err) { send({ type: 'ryx:log', level: 'error', msg: 'Không bật được PiP', detail: String(err), url: location.href }); }
    pipTap.remove(); pipTap = null;
  }, true);
  (document.body || root).appendChild(pipTap);
  setTimeout(function(){ if (pipTap) { pipTap.remove(); pipTap = null; } }, 4000);
  send({ type: 'ryx:log', level: 'info', msg: 'iOS không cho bật PiP từ menu, hiện nút chạm', detail: String(why || ''), url: location.href });
}
function pipFromMenu(){
  var v = lpVideo;
  if (!v || !v.isConnected) { var vs = document.getElementsByTagName('video'); v = vs.length ? vs[0] : null; }
  /* Video nằm trong khung nhúng (iframe) của trang khác: nhờ script trong khung đó bật */
  if (!v) { var fr = document.getElementsByTagName('iframe'); for (var i = 0; i < fr.length; i++) { try { fr[i].contentWindow.postMessage({ ryxPip: 1 }, '*'); } catch (e) {} } return; }
  if (!v || !pipSupported(v)) { send({ type: 'ryx:log', level: 'warn', msg: 'Video này không hỗ trợ PiP', url: location.href }); return; }
  try {
    var want = pipToggle(v);
    setTimeout(function(){ if (v.webkitPresentationMode !== want) pipFallback(v, 'chế độ vẫn là ' + v.webkitPresentationMode); }, 700);
  } catch (err) { pipFallback(v, err); }
}

/* Ghi lại script/CSS nào đã tải xong hoặc lỗi, để biết trang đang chờ tệp nào khi bị treo */
function trackRes(e){ var t = e.target; if (t && (t.tagName === 'SCRIPT' || t.tagName === 'LINK')) t.__ryxDone = e.type; }
document.addEventListener('load', trackRes, true);
document.addEventListener('error', trackRes, true);
function reportPending(){
  var els = document.querySelectorAll('script[src],link[rel~="stylesheet"][href]'), out = [];
  for (var i = 0; i < els.length; i++) {
    var el = els[i]; if (el.__ryxDone) continue;
    var kind = el.tagName === 'SCRIPT' ? ((el.async || el.defer) ? 'script (không chặn trang)' : 'script (CHẶN trang)') : 'css';
    out.push(kind + ' ' + String(el.src || el.href).slice(0, 160));
  }
  send({ type: 'ryx:pending', state: document.readyState, total: els.length, list: out.slice(0, 25) });
}

/* "Chạm để ẩn quảng cáo": chọn phần tử, app hỏi lại rồi lưu bộ chọn cho trang này */
var pickOn = false, pickSet = [], pickHeld = null, pickLp = null, pickLpFired = 0, pickX = 0, pickY = 0;
function pickCss(){
  styleEl('ryx-pick').textContent = pickOn ?
    '[data-ryx-pick]{outline:3px solid #F87171!important;outline-offset:-3px!important;background-color:rgba(248,113,113,.18)!important;}iframe,video{pointer-events:none!important;}*{-webkit-touch-callout:none!important;-webkit-user-select:none!important;}' : '';
}
function setMark(el, on){ if (on) el.setAttribute('data-ryx-pick', ''); else el.removeAttribute('data-ryx-pick'); }
function pickClearAll(){ for (var i = 0; i < pickSet.length; i++) setMark(pickSet[i], false); pickSet = []; pickHeld = null; }
/* Thêm 1 mục: bỏ các mục đã chọn nằm bên trong nó (đã gồm rồi) */
function pickAdd(el){
  pickSet = pickSet.filter(function(x){ if (el.contains(x)) { setMark(x, false); return false; } return true; });
  pickSet.push(el); setMark(el, true);
}
function pickedOf(t){ if (!t || !t.closest) return null; var c = t.closest('[data-ryx-pick]'); return c && pickSet.indexOf(c) >= 0 ? c : null; }
function pickCount(){ send({ type: 'ryx:pick', kind: 'count', count: pickSet.length }); }
function esc(x){ return (window.CSS && CSS.escape) ? CSS.escape(x) : x; }
function goodToken(t){ return !!t && t.length < 40 && !/[0-9]{3,}/.test(t) && t.indexOf('ryx') < 0; }
function selFor(el){
  if (el.tagName === 'IFRAME' && el.src) {
    var s = String(el.src), i = s.indexOf('//');
    if (i >= 0) { var h = s.slice(i + 2).split('/')[0].split('?')[0]; if (h) return 'iframe[src*="' + h + '"]'; }
  }
  var parts = [], cur = el;
  for (var d = 0; cur && cur.nodeType === 1 && cur !== document.body && cur !== root && d < 6; d++) {
    if (cur.id && goodToken(cur.id)) { parts.unshift('#' + esc(cur.id)); break; }
    var p = cur.tagName.toLowerCase();
    var cls = (typeof cur.className === 'string' ? cur.className : '').split(' ').filter(goodToken).slice(0, 2);
    if (cls.length) p += '.' + cls.map(esc).join('.');
    var par = cur.parentElement;
    if (par && !cls.length) {
      var same = 0, idx = 0;
      for (var k = 0; k < par.children.length; k++) { if (par.children[k].tagName === cur.tagName) { same++; if (par.children[k] === cur) idx = same; } }
      if (same > 1) p += ':nth-of-type(' + idx + ')';
    }
    parts.unshift(p);
    try { if (document.querySelectorAll(parts.join(' > ')).length === 1) break; } catch (e) {}
    cur = par;
  }
  return parts.join(' > ');
}
/* Chế độ chọn: chạm = chọn/bỏ chọn; giữ đúng một mục đã chọn = app hiện menu (ẩn / chọn khung lớn hơn / bỏ chọn) */
function pickSwallow(e){
  if (!pickOn) return;
  if (e.type === 'touchstart' && e.touches && e.touches.length === 1) {
    pickX = e.touches[0].clientX; pickY = e.touches[0].clientY;
    var held = pickedOf(e.target);
    clearTimeout(pickLp); pickLp = null;
    if (held) pickLp = setTimeout(function(){
      pickLp = null; pickLpFired = Date.now(); pickHeld = held;
      var r = held.getBoundingClientRect();
      send({ type: 'ryx:pick', kind: 'menu', count: pickSet.length, tag: held.tagName.toLowerCase(), w: Math.round(r.width), h: Math.round(r.height), x: pickX, y: pickY });
    }, 450);
  } else if (e.type === 'touchend') { clearTimeout(pickLp); pickLp = null; }
  e.stopImmediatePropagation();
}
['pointerdown', 'mousedown', 'touchstart', 'touchend', 'mouseup', 'pointerup'].forEach(function(t){ window.addEventListener(t, pickSwallow, true); });
window.addEventListener('touchmove', function(e){
  if (!pickOn || !pickLp || !e.touches || !e.touches[0]) return;
  if (Math.abs(e.touches[0].clientX - pickX) + Math.abs(e.touches[0].clientY - pickY) > 12) { clearTimeout(pickLp); pickLp = null; }
}, { passive: true, capture: true });
window.addEventListener('click', function(e){
  if (!pickOn) return;
  e.preventDefault(); e.stopImmediatePropagation();
  if (Date.now() - pickLpFired < 700) return;
  var t = e.target; if (!t || t === document.body || t === root || t === document.documentElement) return;
  var already = pickedOf(t);
  if (already) { pickSet.splice(pickSet.indexOf(already), 1); setMark(already, false); }
  else pickAdd(t);
  pickCount();
}, true);

/* Ghi lại link playlist HLS (.m3u8) mà trình phát tải về, để "Tải video" ghép được thành mp4 */
(function(){
  var seen = {};
  function hls(u){ try { u = String(u || ''); if (!/\\.m3u8(\\?|#|$)/i.test(u.split('#')[0]) || seen[u]) return; seen[u] = 1; u = new URL(u, location.href).href; send({ type: 'ryx:hls', url: u, page: location.href }); } catch (e) {} }
  try { var xo = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function(m, u){ hls(u); return xo.apply(this, arguments); }; } catch (e) {}
  try { var f0 = window.fetch; if (f0) window.fetch = function(i){ hls(i && i.url ? i.url : i); return f0.apply(this, arguments); }; } catch (e) {}
  document.addEventListener('loadstart', function(e){ var v = e.target; if (v && v.tagName === 'VIDEO') hls(v.currentSrc || v.src); }, true);
})();
window.__ryx = {
  pending: reportPending,
  pick: function(on){ pickOn = !!on; if (!pickOn) pickClearAll(); pickCss(); },
  /* Mục đang giữ → khung cha của nó */
  pickParent: function(){
    var h = pickHeld, p = h && h.parentElement;
    if (!h || !p || p === document.body || p === root || p === document.documentElement) return;
    pickSet.splice(pickSet.indexOf(h), 1); setMark(h, false);
    pickAdd(p); pickHeld = p; pickCount();
  },
  pickClear: function(){ pickClearAll(); pickCount(); },
  /* Ẩn tất cả mục đã chọn: gửi bộ chọn cho app lưu lại */
  pickHide: function(){
    var sels = [];
    for (var i = 0; i < pickSet.length; i++) { var x = selFor(pickSet[i]); if (x && sels.indexOf(x) < 0) sels.push(x); }
    send({ type: 'ryx:pick', kind: 'done', selectors: sels });
  },
  update: function(c){ CFG = c; P = prefs(); applyAll(); post(); },
  pip: pipFromMenu,
  report: post
};
} catch (err) {
  try { window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ryx:log', level: 'error', msg: 'Script chặn quảng cáo lỗi: ' + (err && err.message || err), detail: String(err && err.stack || ''), url: location.href })); } catch (e) {}
}
})(); true;`;
}

export function buildUpdateCall(cfg: InjectConfig): string {
  return `window.__ryx && window.__ryx.update(${JSON.stringify(cfg)}); true;`;
}

/**
 * Script nhỏ chạy trong các khung nhúng (iframe), vd trình phát video của trang khác.
 * Script chính chỉ chạy ở trang chính, nên trước đây nhấn giữ video trong iframe thì iOS tô xám video thay vì hiện menu của Ryx.
 * Ở đây: tắt menu/tô chọn của iOS trên video & ảnh, nhấn giữ video → gửi cho app hiện menu (Tải video, PiP…).
 */
export const FRAME_MEDIA_SCRIPT = `(function(){
if (window.top === window || window.__ryxFrame) return; window.__ryxFrame = 1;
function send(o){ try { window.webkit.messageHandlers.ReactNativeWebView.postMessage(JSON.stringify(o)); } catch (e) {} }
try {
  var st = document.createElement('style');
  /* Khung nhúng thường chỉ là trình phát: tắt lớp tô xám, menu và chọn chữ của iOS cho mọi phần tử trong khung */
  st.textContent = '*{-webkit-tap-highlight-color:transparent!important;-webkit-touch-callout:none!important;}video,img,a,video~*,[class*=player],[class*=player] *,[id*=player],[id*=player] *{-webkit-user-select:none!important;user-select:none!important;}';
  (document.head || document.documentElement).appendChild(st);
} catch (e) {}
function videoAt(x, y){
  var vs = document.getElementsByTagName('video'), best = null, area = 0;
  for (var i = 0; i < vs.length; i++) {
    var r = vs[i].getBoundingClientRect();
    if (r.width < 80 || x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
    if (r.width * r.height > area) { area = r.width * r.height; best = vs[i]; }
  }
  return best;
}
var lp = null, lx = 0, ly = 0, fired = 0, last = null;
/* Ghi lại link playlist HLS (.m3u8) mà trình phát tải về, để "Tải video" ghép được thành mp4 */
(function(){
  var seen = {};
  function hls(u){ try { u = String(u || ''); if (!/\\.m3u8(\\?|#|$)/i.test(u.split('#')[0]) || seen[u]) return; seen[u] = 1; u = new URL(u, location.href).href; send({ type: 'ryx:hls', url: u, page: location.href }); } catch (e) {} }
  try { var xo = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function(m, u){ hls(u); return xo.apply(this, arguments); }; } catch (e) {}
  try { var f0 = window.fetch; if (f0) window.fetch = function(i){ hls(i && i.url ? i.url : i); return f0.apply(this, arguments); }; } catch (e) {}
  document.addEventListener('loadstart', function(e){ var v = e.target; if (v && v.tagName === 'VIDEO') hls(v.currentSrc || v.src); }, true);
})();
document.addEventListener('selectstart', function(e){ if (videoAt(lx, ly)) e.preventDefault(); }, true);
document.addEventListener('contextmenu', function(e){ e.preventDefault(); }, true);
function pipOk(v){ return !!(v && v.webkitSupportsPresentationMode && v.webkitSupportsPresentationMode('picture-in-picture')); }
document.addEventListener('touchstart', function(e){
  if (!e.touches || e.touches.length !== 1) return;
  lx = e.touches[0].clientX; ly = e.touches[0].clientY;
  var v = videoAt(lx, ly); if (!v) return;
  clearTimeout(lp);
  lp = setTimeout(function(){
    lp = null; fired = Date.now(); last = v;
    var so = v.querySelector ? v.querySelector('source') : null;
    send({ type: 'ryx:media', inFrame: true, kind: 'video', src: String(v.currentSrc || v.src || (so ? so.src : '') || ''), poster: String(v.poster || ''), link: '', url: location.href, playing: !v.paused, pip: pipOk(v), title: document.title, x: lx, y: ly });
  }, 550);
}, { passive: true, capture: true });
function cancel(e){
  if (!lp) return;
  if (e.type === 'touchmove' && e.touches && e.touches[0] && Math.abs(e.touches[0].clientX - lx) < 10 && Math.abs(e.touches[0].clientY - ly) < 10) return;
  clearTimeout(lp); lp = null;
}
document.addEventListener('touchmove', cancel, { passive: true, capture: true });
document.addEventListener('touchend', cancel, { passive: true, capture: true });
document.addEventListener('touchcancel', cancel, { passive: true, capture: true });
document.addEventListener('click', function(e){ if (Date.now() - fired < 800) { e.preventDefault(); e.stopPropagation(); } }, true);
window.addEventListener('message', function(e){
  if (!e.data || !e.data.ryxPip) return;
  var v = last || document.getElementsByTagName('video')[0];
  if (!pipOk(v)) return;
  try { v.webkitSetPresentationMode(v.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture'); }
  catch (err) { send({ type: 'ryx:log', level: 'warn', msg: 'Không bật được PiP trong khung nhúng', detail: String(err), url: location.href }); }
});
})(); true;`;
