const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const HOST_LIKE_RE = /^(localhost|(\d{1,3}\.){3}\d{1,3}|([\p{L}\p{N}-]+\.)+[\p{L}]{2,})(:\d+)?(\/.*)?$/u;

/** Biến nội dung ô địa chỉ thành URL: địa chỉ web hoặc tìm kiếm Google. */
export function resolveInput(raw: string): string {
  const input = raw.trim();
  if (!input) return '';
  if (SCHEME_RE.test(input)) return input;
  if (!/\s/.test(input) && HOST_LIKE_RE.test(input)) {
    const local = /^(localhost|(\d{1,3}\.){3}\d{1,3})(:|\/|$)/.test(input);
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
