const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const HOST_LIKE_RE = /^(localhost|(\d{1,3}\.){3}\d{1,3}|([\p{L}\p{N}-]+\.)+[\p{L}]{2,})(:\d+)?(\/.*)?$/u;

/** Biến nội dung ô địa chỉ thành URL: địa chỉ web hoặc tìm kiếm Google. */
export function resolveInput(raw: string): string {
  const input = raw.trim();
  if (!input) return '';
  if (SCHEME_RE.test(input)) return input;
  if (!/\s/.test(input) && HOST_LIKE_RE.test(input)) {
    // Chỉ mạng nội bộ mới dùng http; IP công cộng (vd 1.1.1.1) vẫn dùng https
    const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(input);
    return `${local ? 'http' : 'https'}://${input}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
}

export function getHost(url: string | null | undefined): string {
  if (!url) return '';
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#:]+)/i.exec(url);
  return m ? m[1].toLowerCase() : '';
}

/** Tên miền hiển thị gọn (bỏ "www."). */
export function displayHost(url: string | null | undefined): string {
  return getHost(url).replace(/^www\./, '');
}

/** Tên miền gốc, vd m.xnhau.pink → xnhau.pink, abc.com.vn → abc.com.vn. Dùng để so hai trang có cùng site không. */
export function registrableDomain(host: string): string {
  const parts = host.replace(/\.$/, '').split('.');
  if (parts.length <= 2) return host;
  const last2 = parts.slice(-2).join('.');
  if (/^(com|net|org|edu|gov|co|ac|info|biz)\.[a-z]{2}$/.test(last2)) return parts.slice(-3).join('.');
  return last2;
}

/** Khoá dùng để lưu tuỳ chọn theo trang. */
export function siteKey(url: string | null | undefined): string {
  return displayHost(url);
}

export function isSecure(url: string | null | undefined): boolean {
  return !!url && url.startsWith('https://');
}

export function faviconFor(url: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(getHost(url))}&sz=64`;
}
