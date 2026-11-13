import { AUTOCONSENT_JS } from '@/generated/autoconsent';

/**
 * Tự từ chối bảng hỏi cookie bằng autoconsent của DuckDuckGo (bản tự chạy, đã gồm luật; MPL-2.0).
 * Nó tìm bảng hỏi của các nền tảng quen thuộc (OneTrust, Cookiebot, Quantcast…) rồi bấm "Từ chối"
 * giống người dùng, nên trang ghi nhận đúng là đã từ chối. Bảng nào không nhận ra thì danh sách
 * EasyList Cookie (trong bộ lọc tầng mạng) che đi.
 *
 * offSites: các trang cậu đã tắt tính năng này (trong bảng Shield của trang).
 */
export function buildCookieScript(offSites: string[]): string {
  const off = JSON.stringify(offSites);
  return `;(function(){
try {
  if (window.top !== window || window.__ryxCookie) return; window.__ryxCookie = 1;
  var h = location.hostname.replace(/^www\\./, ''), off = ${off};
  for (var i = 0; i < off.length; i++) if (h === off[i] || h.slice(-off[i].length - 1) === '.' + off[i]) return;
} catch (e) { return; }
${AUTOCONSENT_JS}
/* Báo cho Ryx khi đã xử lý xong một bảng hỏi (để ghi nhật ký) */
(function(){
  var sent = false, n = 0;
  var t = setInterval(function(){
    n++;
    try {
      var ms = (window.autoconsentStandalone && window.autoconsentStandalone.messages) || [];
      for (var i = 0; i < ms.length && !sent; i++) {
        var m = ms[i];
        if (m.type === 'autoconsentDone' || (m.type === 'optOutResult' && m.result)) {
          sent = true;
          window.webkit.messageHandlers.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ryx:cookie', cmp: String(m.cmp || ''), clicks: m.totalClicks || 0 }));
        }
      }
    } catch (e) {}
    if (sent || n > 30) clearInterval(t);
  }, 1000);
})();
})();`;
}
