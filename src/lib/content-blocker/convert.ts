/**
 * Chuyển bộ lọc kiểu Adblock Plus (EasyList, ABPVN…) sang luật Content Blocking của WebKit
 * (WKContentRuleList, cùng định dạng Safari Content Blocker).
 *
 * Chỉ hỗ trợ phần cú pháp mà WebKit làm được; luật nào không chuyển chắc chắn đúng thì bỏ qua
 * (bỏ sót còn hơn chặn nhầm làm hỏng trang).
 */

export interface WkTrigger {
  'url-filter': string;
  'url-filter-is-case-sensitive'?: boolean;
  'if-domain'?: string[];
  'unless-domain'?: string[];
  'load-type'?: ('first-party' | 'third-party')[];
  'resource-type'?: string[];
}

export interface WkRule {
  trigger: WkTrigger;
  action: { type: 'block' } | { type: 'css-display-none'; selector: string } | { type: 'ignore-previous-rules' };
}

export interface ConvertStats {
  lines: number;
  block: number;
  hide: number;
  allow: number;
  skipped: number;
}

/** WebKit giới hạn 150.000 luật cho mỗi danh sách. */
export const MAX_RULES = 145000;
const SELECTORS_PER_RULE = 250;

const TYPE_MAP: Record<string, string> = {
  script: 'script',
  image: 'image',
  stylesheet: 'style-sheet',
  font: 'font',
  media: 'media',
  subdocument: 'document',
  xmlhttprequest: 'raw',
  websocket: 'websocket',
  ping: 'ping',
  popup: 'popup',
  other: 'other',
  object: 'other',
};

/** Tuỳ chọn không làm được trên WebKit → bỏ cả luật. */
const UNSUPPORTED_OPTS = new Set([
  'redirect',
  'redirect-rule',
  'removeparam',
  'csp',
  'rewrite',
  'replace',
  'header',
  'permissions',
  'urltransform',
  'uritransform',
  'denyallow',
  'method',
  'to',
  'badfilter',
  'genericblock',
  'generichide',
  'elemhide',
  'specifichide',
  'ehide',
  'ghide',
  'shide',
  'content',
  'jsinject',
  'urlblock',
  'extension',
  'stealth',
  'cookie',
  'network',
  'app',
  'webrtc',
  'empty',
  'mp4',
  'inline-script',
  'inline-font',
  'strict1p',
  'strict3p',
]);

/** Bộ chọn mở rộng của uBO/AdGuard mà CSS thường không hiểu. */
const EXTENDED_SELECTOR =
  /:(?:-abp-|has-text|contains|xpath|matches-|upward|remove|style\(|min-text-length|watch-attr|others|nth-ancestor|if\(|if-not|-ext-|matches-path|matches-attr)/;

const ASCII = /^[\x20-\x7e]*$/;

function escapeRegex(s: string): string {
  return s.replace(/[.+?()[\]{}\\$]/g, (c) => `\\${c}`);
}

/** Đổi mẫu URL của Adblock sang regex mà WebKit chấp nhận (không dùng | hay {n}). */
export function patternToRegex(pattern: string): string | null {
  let p = pattern;
  if (!p || !ASCII.test(p)) return null;
  if (p.length > 2 && p.startsWith('/') && p.endsWith('/')) return null; // regex gốc: bỏ
  let prefix = '';
  let suffix = '';
  if (p.startsWith('||')) {
    prefix = '^[^:]+://+([^:/]+\\.)?';
    p = p.slice(2);
  } else if (p.startsWith('|')) {
    prefix = '^';
    p = p.slice(1);
  }
  if (p.endsWith('|')) {
    suffix = '$';
    p = p.slice(0, -1);
  }
  if (p.includes('|')) return null;
  // Bỏ * thừa ở hai đầu
  while (p.startsWith('*')) {
    p = p.slice(1);
    if (prefix === '^') prefix = '';
  }
  while (p.endsWith('*')) p = p.slice(0, -1);
  if (!p) return null;

  let out = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') out += '.*';
    else if (c === '^') out += i === p.length - 1 ? '([/:?=&].*)?$' : '[/:?=&]';
    else out += escapeRegex(c);
  }
  if (out.endsWith('$') && suffix === '$') suffix = '';
  const re = prefix + out + suffix;
  // Mẫu quá chung (vd chỉ "ad") dễ chặn nhầm
  if (!prefix && out.replace(/\\/g, '').length < 4) return null;
  return re;
}

function parseDomains(list: string, sep: string): { inc: string[]; exc: string[] } | null {
  const inc: string[] = [];
  const exc: string[] = [];
  for (const raw of list.split(sep)) {
    const d = raw.trim().toLowerCase();
    if (!d) continue;
    const neg = d.startsWith('~');
    const name = neg ? d.slice(1) : d;
    // Bỏ tên miền có ký tự đại diện/regex hoặc không phải ASCII
    if (!name || !ASCII.test(name) || /[*/\\]/.test(name)) return null;
    (neg ? exc : inc).push(`*${name}`);
  }
  return { inc, exc };
}

function applyDomains(t: WkTrigger, d: { inc: string[]; exc: string[] }): void {
  // WebKit không cho dùng cả if-domain lẫn unless-domain: ưu tiên danh sách được áp dụng
  if (d.inc.length) t['if-domain'] = d.inc;
  else if (d.exc.length) t['unless-domain'] = d.exc;
}

function convertNetwork(line: string, block: WkRule[], allow: WkRule[]): boolean {
  let rule = line;
  const isAllow = rule.startsWith('@@');
  if (isAllow) rule = rule.slice(2);

  let opts: string[] = [];
  const dollar = rule.lastIndexOf('$');
  if (dollar > 0 && /^[\w~,=|.*\-:]+$/.test(rule.slice(dollar + 1))) {
    opts = rule.slice(dollar + 1).split(',');
    rule = rule.slice(0, dollar);
  }

  const trigger: WkTrigger = { 'url-filter': '' };
  const types: string[] = [];
  let pageAllow = false;
  for (const o of opts) {
    const [k0, v] = o.split('=');
    const k = k0.trim().toLowerCase();
    if (k === 'third-party' || k === '3p') trigger['load-type'] = ['third-party'];
    else if (k === '~third-party' || k === '1p' || k === 'first-party') trigger['load-type'] = ['first-party'];
    else if (k === 'domain' || k === 'from') {
      if (!v) return false;
      const d = parseDomains(v, '|');
      if (!d) return false;
      applyDomains(trigger, d);
    } else if (k === 'match-case') trigger['url-filter-is-case-sensitive'] = true;
    else if (k === 'important' || k === 'all') {
      // không đổi gì
    } else if (k === 'document' || k === 'doc') {
      if (!isAllow) return false; // chặn cả trang: bỏ
      pageAllow = true;
    } else if (TYPE_MAP[k]) types.push(TYPE_MAP[k]);
    else if (k.startsWith('~') && TYPE_MAP[k.slice(1)]) return false; // loại trừ kiểu: bỏ cho chắc
    else if (UNSUPPORTED_OPTS.has(k)) return false;
    else return false; // tuỳ chọn lạ: bỏ
  }

  if (pageAllow) {
    // @@||site.com^$document → không chặn gì trên trang site.com
    const host = /^\|\|([a-z0-9.-]+)\^?$/i.exec(rule);
    if (!host) return false;
    allow.push({
      trigger: { 'url-filter': '.*', 'if-domain': [`*${host[1].toLowerCase()}`] },
      action: { type: 'ignore-previous-rules' },
    });
    return true;
  }

  const re = patternToRegex(rule);
  if (!re) return false;
  trigger['url-filter'] = re;
  if (types.length) trigger['resource-type'] = Array.from(new Set(types));
  (isAllow ? allow : block).push({
    trigger,
    action: isAllow ? { type: 'ignore-previous-rules' } : { type: 'block' },
  });
  return true;
}

export interface Converted {
  rules: WkRule[];
  stats: ConvertStats;
}

/** Chuyển nội dung (nhiều file nối lại) thành danh sách luật WebKit. */
export function convertFilters(text: string): Converted {
  const block: WkRule[] = [];
  const allow: WkRule[] = [];
  const generic: string[] = [];
  const genericSeen = new Set<string>();
  const specific = new Map<string, { d: { inc: string[]; exc: string[] }; sels: string[] }>();
  const stats: ConvertStats = { lines: 0, block: 0, hide: 0, allow: 0, skipped: 0 };

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('!') || line.startsWith('[')) continue;
    stats.lines++;

    // Luật ẩn phần tử
    const hideAt = line.indexOf('##');
    if (hideAt >= 0) {
      const domains = line.slice(0, hideAt);
      const sel = line.slice(hideAt + 2).trim();
      if (
        !sel ||
        sel.startsWith('+js') ||
        sel.startsWith('^') ||
        EXTENDED_SELECTOR.test(sel) ||
        !ASCII.test(sel) ||
        sel.includes('{')
      ) {
        stats.skipped++;
        continue;
      }
      if (!domains) {
        if (!genericSeen.has(sel)) {
          genericSeen.add(sel);
          generic.push(sel);
        }
        continue;
      }
      const d = parseDomains(domains, ',');
      if (!d || (!d.inc.length && !d.exc.length)) {
        stats.skipped++;
        continue;
      }
      const key = [...d.inc, '|', ...d.exc].join(',');
      const g = specific.get(key) ?? { d, sels: [] };
      g.sels.push(sel);
      specific.set(key, g);
      continue;
    }
    // Ngoại lệ ẩn phần tử, luật script/CSS của AdGuard/uBO: không làm được
    if (/#[@?$%]#|#@\$#|\$\$|#\+js/.test(line)) {
      stats.skipped++;
      continue;
    }
    if (!convertNetwork(line, block, allow)) stats.skipped++;
  }

  const hide: WkRule[] = [];
  for (let i = 0; i < generic.length; i += SELECTORS_PER_RULE) {
    hide.push({
      trigger: { 'url-filter': '.*' },
      action: { type: 'css-display-none', selector: generic.slice(i, i + SELECTORS_PER_RULE).join(', ') },
    });
  }
  for (const { d, sels } of specific.values()) {
    for (let i = 0; i < sels.length; i += SELECTORS_PER_RULE) {
      const trigger: WkTrigger = { 'url-filter': '.*' };
      applyDomains(trigger, d);
      hide.push({ trigger, action: { type: 'css-display-none', selector: sels.slice(i, i + SELECTORS_PER_RULE).join(', ') } });
    }
  }

  stats.block = block.length;
  stats.hide = hide.length;
  stats.allow = allow.length;
  // Thứ tự quan trọng: ignore-previous-rules chỉ bỏ các luật đứng TRƯỚC nó
  let rules = [...block, ...hide, ...allow];
  if (rules.length > MAX_RULES) rules = [...block.slice(0, MAX_RULES - hide.length - allow.length), ...hide, ...allow];
  return { rules, stats };
}

/** Luật cho phép theo trang (Shield tắt chặn quảng cáo ở trang đó). Đặt CUỐI danh sách. */
export function siteAllowRules(sites: string[]): WkRule[] {
  return sites
    .filter((s) => s && ASCII.test(s))
    .map((s) => ({
      trigger: { 'url-filter': '.*', 'if-domain': [`*${s.toLowerCase()}`] },
      action: { type: 'ignore-previous-rules' as const },
    }));
}

/** Luật chặn theo danh sách tên miền (bộ lọc riêng của Ryx). */
export function domainBlockRules(domains: string[]): WkRule[] {
  return domains
    .filter((d) => d && ASCII.test(d))
    .map((d) => ({
      trigger: { 'url-filter': `^[^:]+://+([^:/]+\\.)?${escapeRegex(d.toLowerCase())}[/:?=&]` },
      action: { type: 'block' as const },
    }));
}
