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
styleEl('ryx-lp').textContent = 'img,video,a{-webkit-touch-callout:none!important;}';
var lp = null, lpX = 0, lpY = 0, lpFired = 0;
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
document.addEventListener('touchstart', function(e){
  if (!e.touches || e.touches.length !== 1) return;
  var x = e.touches[0].clientX, y = e.touches[0].clientY;
  var m = videoAt(x, y) || mediaAt(e.target);
  var link = !m && e.target && e.target.closest ? e.target.closest('a[href]') : null;
  if (!m && !(link && /^https?:/i.test(link.href))) return;
  lpX = x; lpY = y;
  clearTimeout(lp);
  lp = setTimeout(function(){
    lp = null; lpFired = Date.now();
    if (!m) {
      send({ type: 'ryx:link', href: link.href, text: String(link.textContent || link.title || '').trim().slice(0, 120), url: location.href, x: lpX, y: lpY });
      return;
    }
    var isV = m.tagName === 'VIDEO';
    var so = isV && m.querySelector ? m.querySelector('source') : null;
    var src = isV ? (m.currentSrc || m.src || (so ? so.src : '')) : (m.currentSrc || m.src || '');
    var a = m.closest('a');
    send({ type: 'ryx:media', kind: isV ? 'video' : 'image', src: String(src || ''), poster: isV ? String(m.poster || '') : '', link: a ? a.href : '', url: location.href, playing: isV && !m.paused, title: document.title, x: lpX, y: lpY });
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

/* Nút PiP nổi trên video lớn đang phát (bấm thật nên iOS cho bật Picture-in-Picture) */
var pipBtn = null, pipVideo = null, pipTimer = null;
function pipSupported(v){ return !!(v && (v.webkitSupportsPresentationMode && v.webkitSupportsPresentationMode('picture-in-picture'))); }
function placePip(){
  if (!pipBtn || !pipVideo) return;
  var r = pipVideo.getBoundingClientRect();
  if (r.width < 200 || r.bottom < 0 || r.top > window.innerHeight) { pipBtn.style.display = 'none'; return; }
  pipBtn.style.display = 'flex';
  pipBtn.style.top = (r.top + window.scrollY + 10) + 'px';
  pipBtn.style.left = (r.right + window.scrollX - 50) + 'px';
}
function showPip(v){
  if (!pipSupported(v) || (v.offsetWidth || 0) < 200) return;
  pipVideo = v;
  if (!pipBtn) {
    pipBtn = document.createElement('div');
    pipBtn.setAttribute('role', 'button');
    pipBtn.setAttribute('aria-label', 'Hình trong hình');
    pipBtn.style.cssText = 'position:absolute;z-index:2147483647;width:40px;height:40px;border-radius:20px;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;-webkit-backdrop-filter:blur(8px);';
    pipBtn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="3"/><rect x="12" y="11" width="8" height="6" rx="1.5" fill="#fff"/></svg>';
    pipBtn.addEventListener('click', function(e){
      e.preventDefault(); e.stopPropagation();
      var v2 = pipVideo; if (!v2) return;
      try {
        var mode = v2.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture';
        v2.webkitSetPresentationMode(mode);
      } catch (err) { send({ type: 'ryx:log', msg: 'Không bật được PiP', detail: String(err), url: location.href }); }
    }, true);
    (document.body || root).appendChild(pipBtn);
    window.addEventListener('scroll', placePip, { passive: true });
    window.addEventListener('resize', placePip);
  }
  placePip();
  clearTimeout(pipTimer);
  pipTimer = setInterval(placePip, 1000);
}
function hidePip(){ if (pipBtn) pipBtn.style.display = 'none'; clearInterval(pipTimer); }
document.addEventListener('playing', function(e){ if (e.target && e.target.tagName === 'VIDEO') showPip(e.target); }, true);
document.addEventListener('pause', function(e){ if (e.target === pipVideo && e.target.webkitPresentationMode !== 'picture-in-picture') hidePip(); }, true);
document.addEventListener('ended', function(e){ if (e.target === pipVideo) hidePip(); }, true);

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
var pickOn = false, picked = null;
function pickCss(){
  styleEl('ryx-pick').textContent = pickOn ?
    '[data-ryx-pick]{outline:3px solid #F87171!important;outline-offset:-3px!important;background-color:rgba(248,113,113,.18)!important;}iframe,video{pointer-events:none!important;}' : '';
}
function mark(el){
  if (picked) picked.removeAttribute('data-ryx-pick');
  picked = el || null;
  if (picked) picked.setAttribute('data-ryx-pick', '');
}
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
function reportPick(){
  if (!picked) return;
  var r = picked.getBoundingClientRect();
  send({ type: 'ryx:pick', selector: selFor(picked), tag: picked.tagName.toLowerCase(), w: Math.round(r.width), h: Math.round(r.height) });
}
function pickSwallow(e){ if (pickOn) { e.stopImmediatePropagation(); } }
['pointerdown', 'mousedown', 'touchstart', 'touchend', 'mouseup', 'pointerup'].forEach(function(t){ window.addEventListener(t, pickSwallow, true); });
window.addEventListener('click', function(e){
  if (!pickOn) return;
  e.preventDefault(); e.stopImmediatePropagation();
  var t = e.target; if (!t || t === document.body || t === root) return;
  mark(t); reportPick();
}, true);

window.__ryx = {
  pending: reportPending,
  pick: function(on){ pickOn = !!on; if (!pickOn) mark(null); pickCss(); },
  pickParent: function(){
    if (picked && picked.parentElement && picked.parentElement !== document.body && picked.parentElement !== root) { mark(picked.parentElement); }
    reportPick();
  },
  update: function(c){ CFG = c; P = prefs(); applyAll(); post(); },
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
