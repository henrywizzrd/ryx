import { AD_DOMAINS, GAMBLING_DOMAINS, GAMBLING_HOST_KEYWORDS } from '@/filters';
import type { ShieldPrefs } from '@/state/settings';
import { getHost } from './url';

export type BlockCategory = 'ads' | 'gambling' | 'popups';

const adSet = new Set(AD_DOMAINS);
const gamblingSet = new Set(GAMBLING_DOMAINS);

function matchesDomain(host: string, set: Set<string>): boolean {
  // Kiểm tra host và mọi tên miền cha: a.b.example.com → b.example.com → example.com
  let h = host;
  while (h.includes('.')) {
    if (set.has(h)) return true;
    h = h.slice(h.indexOf('.') + 1);
  }
  return false;
}

export function classifyHost(host: string): 'ad' | 'gambling' | null {
  if (!host) return null;
  if (matchesDomain(host, gamblingSet) || GAMBLING_HOST_KEYWORDS.some((k) => host.includes(k))) {
    return 'gambling';
  }
  if (matchesDomain(host, adSet)) return 'ad';
  return null;
}

/**
 * Quyết định có chặn một yêu cầu điều hướng hay không.
 * - Cờ bạc: luôn tính vào "gambling".
 * - Quảng cáo ở trang chính (chuyển hướng) → "popups"; trong iframe → "ads".
 */
export function shouldBlock(
  url: string,
  isTopFrame: boolean,
  prefs: ShieldPrefs,
): BlockCategory | null {
  if (!/^https?:/i.test(url)) return null;
  const kind = classifyHost(getHost(url));
  if (kind === 'gambling') return prefs.gambling ? 'gambling' : null;
  if (kind === 'ad') {
    if (isTopFrame) return prefs.popups ? 'popups' : null;
    return prefs.ads ? 'ads' : null;
  }
  return null;
}
