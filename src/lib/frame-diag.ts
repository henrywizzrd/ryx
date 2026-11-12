/**
 * Script chẩn đoán video, chạy trong MỌI khung (kể cả iframe của trình phát).
 * Script chính của Ryx chỉ chạy ở trang chính nên không thấy được trình phát nằm trong iframe.
 * Gửi tin thẳng qua window.webkit.messageHandlers (cầu window.ReactNativeWebView chỉ có ở trang chính).
 */
export const FRAME_DIAG_SCRIPT = `(function(){
if (window.__ryxDiag) return; window.__ryxDiag = 1;
var mh = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.ReactNativeWebView;
if (!mh) return;
var TOP = window === window.top;
var HOST = location.hostname || String(location.href).slice(0, 40);
var sent = 0;
function send(ev, o){
  if (sent++ > 40) return;
  var m = { type: 'ryx:diag', ev: ev, top: TOP, host: HOST, href: String(location.href).slice(0, 200) };
  if (o) for (var k in o) m[k] = o[k];
  try { mh.postMessage(JSON.stringify(m)); } catch (e) {}
}
function info(v){
  var s = String((v && (v.currentSrc || v.src)) || '');
  if (!s && v && v.querySelector) { var so = v.querySelector('source'); if (so) s = so.src || ''; }
  var kind = /^blob:/.test(s) ? 'blob (HLS qua MSE)' : /\\.m3u8/i.test(s) ? 'm3u8 (HLS)' : /\\.mp4/i.test(s) ? 'mp4' : s ? 'khác' : 'chưa có nguồn';
  return { src: s.slice(0, 200), kind: kind, rs: v ? v.readyState : -1, ns: v ? v.networkState : -1,
    muted: !!(v && v.muted), inline: !!(v && (v.hasAttribute('playsinline') || v.hasAttribute('webkit-playsinline'))) };
}
var WHY = { 1: 'bị huỷ', 2: 'lỗi mạng', 3: 'lỗi giải mã', 4: 'nguồn/định dạng không hỗ trợ' };
document.addEventListener('play', function(e){
  var v = e.target; if (!v || v.tagName !== 'VIDEO') return;
  clearTimeout(v.__ryxPT);
  v.__ryxPT = setTimeout(function(){ if (v.paused || v.readyState < 3) send('play_stuck', info(v)); }, 8000);
}, true);
document.addEventListener('playing', function(e){
  var v = e.target; if (v && v.__ryxPT) { clearTimeout(v.__ryxPT); v.__ryxPT = 0; }
}, true);
document.addEventListener('stalled', function(e){
  var v = e.target; if (!v || v.tagName !== 'VIDEO' || v.__ryxStall) return;
  v.__ryxStall = 1; send('stalled', info(v));
}, true);
document.addEventListener('error', function(e){
  var t = e.target; if (!t || (t.tagName !== 'VIDEO' && t.tagName !== 'SOURCE')) return;
  var v = t.tagName === 'VIDEO' ? t : t.parentNode;
  var o = info(v); var err = v && v.error;
  o.code = err ? err.code : 0; o.why = WHY[o.code] || ''; o.msg = err && err.message ? String(err.message).slice(0, 150) : '';
  send('media_error', o);
}, true);
try {
  var op = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function(){
    var v = this, p = op.apply(this, arguments);
    if (p && p.catch) p.catch(function(err){
      var o = info(v); o.name = err && err.name; o.msg = String((err && err.message) || '').slice(0, 150);
      send('play_reject', o);
    });
    return p;
  };
} catch (e) {}
/* Lỗi script + tài nguyên (script/ảnh/video) không tải được */
window.addEventListener('error', function(e){
  var t = e.target;
  if (t && t !== window && t.tagName) {
    var u = t.currentSrc || t.src || t.href || '';
    if (u) send('res_error', { tag: t.tagName.toLowerCase(), url: String(u).slice(0, 200) });
    return;
  }
  send('js_error', { msg: String(e.message || '').slice(0, 150), src: String(e.filename || '').slice(0, 150), line: e.lineno || 0 });
}, true);
window.addEventListener('unhandledrejection', function(e){
  var r = e.reason; send('js_error', { msg: String((r && (r.message || r)) || '').slice(0, 150), kind: 'promise' });
});
/* Yêu cầu mạng của trang (fetch / XHR) bị lỗi: trình phát thường lấy link video qua đây */
try {
  var of = window.fetch;
  if (of) window.fetch = function(input){
    var u = String((input && input.url) || input || '').slice(0, 200);
    return of.apply(this, arguments).then(function(res){
      if (res && !res.ok && res.status) send('http_fail', { url: u, status: res.status, via: 'fetch' });
      return res;
    }, function(err){ send('http_fail', { url: u, status: 0, msg: String(err && err.message || err).slice(0, 120), via: 'fetch' }); throw err; });
  };
  var xo = XMLHttpRequest.prototype.open, xs = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(m, u){ this.__ryxU = String(u || '').slice(0, 200); return xo.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function(){
    var x = this;
    x.addEventListener('loadend', function(){ if (x.status === 0 || x.status >= 400) send('http_fail', { url: x.__ryxU, status: x.status, via: 'xhr' }); });
    return xs.apply(this, arguments);
  };
} catch (e) {}
/* Trình phát lớn (không phải ảnh động nhỏ) nhận nguồn video */
document.addEventListener('loadstart', function(e){
  var v = e.target; if (!v || v.tagName !== 'VIDEO') return;
  var w = v.offsetWidth || 0; if (w < 200) return;
  var o = info(v); if (v.__ryxSrc === o.src) return; v.__ryxSrc = o.src;
  o.size = w + 'x' + (v.offsetHeight || 0); send('video_src', o);
}, true);
function report(){
  var vs = document.getElementsByTagName('video');
  if (!vs.length || TOP || (vs[0].offsetWidth || 0) < 200) return;
  var o = info(vs[0]); o.count = vs.length; o.size = vs[0].offsetWidth + 'x' + vs[0].offsetHeight;
  o.mse = typeof window.MediaSource !== 'undefined'; o.mmse = typeof window.ManagedMediaSource !== 'undefined';
  send('frame_video', o);
}
setTimeout(report, 2500);
})();
true;`;

type DiagMsg = {
  ev?: string;
  top?: boolean;
  host?: string;
  href?: string;
  [k: string]: unknown;
};

const SKIP = new Set(['type', 'ev', 'top', 'host']);

/** Đổi tin chẩn đoán thành một dòng nhật ký dễ đọc. */
export function describeDiag(m: DiagMsg): { level: 'info' | 'warn' | 'error'; text: string; detail: string } {
  const where = m.top ? 'trang chính' : `khung ${m.host || '?'}`;
  const detail = Object.keys(m)
    .filter((k) => !SKIP.has(k) && m[k] !== '' && m[k] !== undefined)
    .map((k) => `${k}: ${String(m[k])}`)
    .join('\n');
  switch (m.ev) {
    case 'frame_video':
      return { level: 'info', text: `Tìm thấy trình phát video trong ${where}`, detail };
    case 'play_stuck':
      return { level: 'warn', text: `Video ở ${where} bấm phát 8 s vẫn chưa chạy`, detail };
    case 'stalled':
      return { level: 'warn', text: `Video ở ${where} bị nghẽn khi tải dữ liệu`, detail };
    case 'media_error':
      return { level: 'error', text: `Video ở ${where} báo lỗi: ${String(m.why || 'không rõ')} (mã ${String(m.code ?? '?')})`, detail };
    case 'play_reject':
      return { level: 'warn', text: `Lệnh phát video ở ${where} bị từ chối: ${String(m.name || '?')}`, detail };
    case 'res_error':
      return { level: 'warn', text: `Không tải được ${String(m.tag)} ở ${where}`, detail };
    case 'http_fail':
      return { level: 'warn', text: `Yêu cầu mạng lỗi ${String(m.status)} ở ${where}`, detail };
    case 'video_src':
      return { level: 'info', text: `Trình phát ở ${where} nhận nguồn video: ${String(m.kind)}`, detail };
    case 'js_error':
      return { level: 'warn', text: `Lỗi script trong ${where}`, detail };
    default:
      return { level: 'info', text: `Chẩn đoán video (${String(m.ev)}) ở ${where}`, detail };
  }
}
