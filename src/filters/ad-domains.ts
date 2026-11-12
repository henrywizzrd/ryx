/**
 * Tên miền quảng cáo / theo dõi.
 * Điều hướng (trang chính hoặc iframe) tới các tên miền này sẽ bị chặn.
 * So khớp: trùng tên miền hoặc là tên miền con (vd. "ads.doubleclick.net").
 * Thêm một dòng để cập nhật danh sách.
 */
export const AD_DOMAINS: string[] = [
  // Google
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'adservice.google.com',
  'googletagservices.com',
  // Mạng quảng cáo phổ biến
  'adnxs.com',
  'taboola.com',
  'outbrain.com',
  'criteo.com',
  'criteo.net',
  'amazon-adsystem.com',
  'adform.net',
  'rubiconproject.com',
  'pubmatic.com',
  'openx.net',
  'smartadserver.com',
  'media.net',
  'mgid.com',
  'revcontent.com',
  'zedo.com',
  'yieldmo.com',
  'teads.tv',
  // Quảng cáo pop-up / chuyển hướng
  'popads.net',
  'popcash.net',
  'propellerads.com',
  'adsterra.com',
  'exoclick.com',
  'juicyads.com',
  'trafficjunky.net',
  'hilltopads.net',
  'clickadu.com',
  'onclkds.com',
  'onclickads.net',
  'yllix.com',
  'adcash.com',
  'popmyads.com',
  'galaksion.com',
  // Mạng quảng cáo Việt Nam
  'admicro.vn',
  'eclick.vn',
  'adtima.vn',
  'adtimaserver.vn',
  'ambientplatform.vn',
  'adnetwork.vn',
];
