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
  if (pageIsDark !== null) send({ type: 'ryx:theme', host: HOST, dark: pageIsDark });
});
window.addEventListener('load', scan);

/* Nhấn giữ ảnh/video → app hiện menu (Lưu vào Ảnh, Sao chép link…) */
styleEl('ryx-lp').textContent = 'img,video{-webkit-touch-callout:none!important;}';
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
document.addEventListener('touchstart', function(e){
  if (!e.touches || e.touches.length !== 1) return;
  var m = mediaAt(e.target); if (!m) return;
  lpX = e.touches[0].clientX; lpY = e.touches[0].clientY;
  clearTimeout(lp);
  lp = setTimeout(function(){
    lp = null; lpFired = Date.now();
    var isV = m.tagName === 'VIDEO';
    var so = isV && m.querySelector ? m.querySelector('source') : null;
    var src = isV ? (m.currentSrc || m.src || (so ? so.src : '')) : (m.currentSrc || m.src || '');
    var a = m.closest('a');
    send({ type: 'ryx:media', kind: isV ? 'video' : 'image', src: String(src || ''), poster: isV ? String(m.poster || '') : '', link: a ? a.href : '', url: location.href });
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
