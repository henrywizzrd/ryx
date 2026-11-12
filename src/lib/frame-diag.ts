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
  if (ev !== 'tap_report' && ev !== 'probe' && ev !== 'kick' && sent++ > 40) return;
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
      if (v.__ryxRej) return; v.__ryxRej = 1;
      var o = info(v); o.name = err && err.name;
      try { o.gesture = navigator.userActivation ? (navigator.userActivation.isActive ? 'có' : 'không') : '?'; } catch (e4) {} o.msg = String((err && err.message) || '').slice(0, 150);
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
/* Trang chính: khi bấm vào vùng trình phát, 10 s sau báo lại trình phát đã tải những gì */
if (TOP) {
  var tapAt = 0;
  var PSEL = 'video,[class*="player"],[id*="player"],[class*="fp-"],[class*="jw-"],[class*="vjs"],[class*="plyr"]';
  /* Tự tải thử 1 KB đầu của video trình phát để xem máy chủ trả gì (mã lỗi, chuyển hướng tới đâu) */
  var probed = {};
  function probe(v){
    var src = String(v.currentSrc || v.src || '');
    if (!/^https?:/.test(src) || v.readyState > 0 || probed[src]) return;
    probed[src] = 1;
    var t0 = Date.now();
    var o = { src: src.slice(0, 250) };
    try {
      var done = false;
      setTimeout(function(){ if (!done) { done = true; o.err = 'quá 10 s không có phản hồi (yêu cầu bị treo)'; o.ms = Date.now() - t0; send('probe', o); } }, 10000);
      of.call(window, src, { headers: { Range: 'bytes=0-1023' }, credentials: 'include' }).then(function(res){
        if (done) return; done = true;
        o.status = res.status; o.redirected = res.redirected; o.final = String(res.url).slice(0, 250);
        o.type = res.headers.get('content-type') || ''; o.range = res.headers.get('content-range') || res.headers.get('content-length') || '';
        o.ms = Date.now() - t0; send('probe', o);
      }, function(err){ if (done) return; done = true; o.err = String((err && err.message) || err); o.ms = Date.now() - t0; send('probe', o); });
    } catch (e) { o.err = String(e); send('probe', o); }
  }
  function snapshot(since, why, tapped){
      var res = [];
      try {
        performance.getEntriesByType('resource').forEach(function(r){
          if (r.startTime < since || r.initiatorType === 'img' || r.initiatorType === 'css' || r.initiatorType === 'link') return;
          var u = r.name.split('://').pop() || '';
          res.push(r.initiatorType + ' ' + Math.round(r.duration) + 'ms ' + (r.transferSize || 0) + 'B ' + u.slice(0, 110));
        });
      } catch (e2) {}
      var nodes = [];
      try {
        var ps = document.querySelectorAll(PSEL);
        for (var i = 0; i < ps.length && nodes.length < 8; i++) {
          var n = ps[i]; if ((n.offsetWidth || 0) < 200) continue;
          var d = n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (typeof n.className === 'string' && n.className ? '.' + n.className.split(' ').filter(Boolean).slice(0, 3).join('.') : '');
          if (n.tagName === 'VIDEO') {
            d += ' rs=' + n.readyState + ' ns=' + n.networkState + (n.error ? ' err=' + n.error.code : '') + ' src=' + String(n.currentSrc || n.src || '-').slice(0, 200);
            probe(n);
          }
          nodes.push(d.slice(0, 160));
        }
      } catch (e3) {}
      if (!nodes.length && why === 'auto') return;
      send('tap_report', { why: why, tapped: tapped || '', requests: res.length, list: res.slice(-40).join(' | '), player: nodes.join(' | '),
        ua: navigator.userAgent.slice(0, 160), vis: document.visibilityState });
  }
  document.addEventListener('touchend', function(e){
    var t = e.target; var p = t && t.closest ? t.closest(PSEL) : null;
    if (!p || tapAt) return;
    /* Thử nghiệm: tự gọi play() ngay trong cú chạm thật của cậu (để biết video có phát được không nếu đúng "thao tác người dùng") */
    try {
      /* Chỗ chạm thường là lớp nút phủ lên video: đi ngược lên tới khối có chứa thẻ video */
      var box = p;
      while (box && box !== document.body && !(box.tagName === 'VIDEO' || box.querySelector('video'))) box = box.parentElement;
      var vs2 = !box ? [] : box.tagName === 'VIDEO' ? [box] : box.querySelectorAll('video');
      for (var k = 0; k < vs2.length; k++) {
        var vv = vs2[k];
        if ((vv.offsetWidth || 0) < 200 || vv.readyState > 0 || vv.__ryxKick || !(vv.currentSrc || vv.src)) continue;
        vv.__ryxKick = 1;
        (function(vk){
          var pr = op.call(vk);
          var ko = info(vk);
          if (pr && pr.then) pr.then(function(){ ko.result = 'phát được'; send('kick', ko); }, function(er){ ko.result = 'bị từ chối: ' + (er && er.name); ko.msg = String((er && er.message) || '').slice(0, 150); send('kick', ko); });
          setTimeout(function(){ var k2 = info(vk); k2.result = 'sau 8 s'; k2.paused = vk.paused; send('kick', k2); }, 8000);
        })(vv);
      }
    } catch (e5) {}
    tapAt = performance.now();
    var tg = p.tagName.toLowerCase() + (p.id ? '#' + p.id : '');
    setTimeout(function(){ var since = tapAt; tapAt = 0; snapshot(since, 'tap', tg); }, 10000);
  }, true);
  /* Tự báo 12 s sau khi trang hiện (trình phát quay vòng không cho bấm) */
  document.addEventListener('DOMContentLoaded', function(){ setTimeout(function(){ snapshot(0, 'auto'); }, 12000); });
}
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
    .map((k) => `${k}: ${String(m[k]).split(' | ').join('\n  ')}`)
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
    case 'tap_report':
      return {
        level: 'info',
        text: m.why === 'auto' ? `Trạng thái trình phát 12 s sau khi mở trang (${String(m.requests)} tài nguyên)` : `Sau khi bấm trình phát 10 s: trang tải ${String(m.requests)} tài nguyên`,
        detail,
      };
    case 'kick':
      return { level: 'info', text: `Ryx tự bấm phát trong cú chạm: ${String(m.result)}`, detail };
    case 'probe':
      return {
        level: m.err || (typeof m.status === 'number' && m.status >= 400) ? 'error' : 'info',
        text: m.err ? `Thử tải video của trình phát: lỗi (${String(m.err)})` : `Thử tải video của trình phát: máy chủ trả ${String(m.status)}`,
        detail,
      };
    case 'js_error':
      return { level: 'warn', text: `Lỗi script trong ${where}`, detail };
    default:
      return { level: 'info', text: `Chẩn đoán video (${String(m.ev)}) ở ${where}`, detail };
  }
}
