import { AD_SELECTORS, GAMBLING_SELECTORS, POPUP_SELECTORS } from '@/filters';
import type { ShieldPrefs } from '@/state/settings';

export interface InjectConfig {
  defaults: ShieldPrefs;
  sites: Record<string, Partial<ShieldPrefs>>;
}

/**
 * Script chạy trước khi trang tải (injectedJavaScriptBeforeContentLoaded).
 * - Ẩn quảng cáo/cờ bạc/pop-up bằng CSS và đếm số phần tử bị ẩn.
 * - Chặn window.open tự động (pop-up).
 * - Chế độ tối kiểu Dark Reader (đảo màu + giữ nguyên ảnh/video), bỏ qua trang vốn đã tối.
 * - window.__khien.update(cfg) để áp dụng thay đổi ngay mà không cần tải lại.
 */
export function buildInjectedScript(cfg: InjectConfig): string {
  const data = JSON.stringify({
    cfg,
    sel: { ads: AD_SELECTORS, gambling: GAMBLING_SELECTORS, popups: POPUP_SELECTORS },
  });
  return `(function(){
try {
if (window.__khien) { return; }
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
var SEL = { ads: valid(D.sel.ads), gambling: valid(D.sel.gambling), popups: valid(D.sel.popups) };
var counts = { ads: 0, gambling: 0, popups: 0 };
var P = prefs();

function post(){
  try { window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'khien:counts', url: location.href, counts: counts })); } catch (e) {}
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
  styleEl('khien-hide').textContent = css;
}

function scan(){
  var changed = false;
  ['ads','gambling','popups'].forEach(function(k){
    if (!P[k] || !SEL[k]) return;
    var els; try { els = document.querySelectorAll(SEL[k]); } catch (e) { return; }
    for (var i = 0; i < els.length; i++) {
      if (!els[i].__khienSeen) { els[i].__khienSeen = 1; counts[k]++; changed = true; }
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

/* Chế độ tối */
var DARK_CSS = 'html{background:#fff!important;filter:invert(0.9) hue-rotate(180deg)!important;}' +
  'img,video,picture,canvas,iframe,embed,object,svg image,[style*="background-image"]{filter:invert(1) hue-rotate(180deg)!important;}';
var pageIsDark = null;
function luminance(c){
  var m = /rgba?\\(([^)]+)\\)/.exec(c || ''); if (!m) return null;
  var p = m[1].split(',').map(parseFloat);
  if (p.length > 3 && p[3] < 0.1) return null;
  return (0.2126*p[0] + 0.7152*p[1] + 0.0722*p[2]) / 255;
}
function detectDark(){
  var s = document.getElementById('khien-dark'); var prev = s ? s.textContent : '';
  if (s) s.textContent = '';
  var l = luminance(getComputedStyle(document.body || root).backgroundColor);
  if (l === null) l = luminance(getComputedStyle(root).backgroundColor);
  if (s) s.textContent = prev;
  var meta = document.querySelector('meta[name="color-scheme"]');
  pageIsDark = (l !== null && l < 0.35) || (!!meta && /^\\s*dark\\s*$/.test(meta.content));
}
function applyDark(){
  styleEl('khien-dark').textContent = (P.dark && pageIsDark !== true) ? DARK_CSS : '';
}

function applyAll(){ applyHide(); applyDark(); scan(); }

applyHide(); applyDark();
new MutationObserver(scheduleScan).observe(root, { childList: true, subtree: true });
document.addEventListener('DOMContentLoaded', function(){ detectDark(); applyAll(); post(); });
window.addEventListener('load', scan);

window.__khien = {
  update: function(c){ CFG = c; P = prefs(); applyAll(); post(); },
  report: post
};
} catch (err) {}
})(); true;`;
}

export function buildUpdateCall(cfg: InjectConfig): string {
  return `window.__khien && window.__khien.update(${JSON.stringify(cfg)}); true;`;
}
