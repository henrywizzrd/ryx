// Tạo src/generated/autoconsent.ts từ bản "standalone" (đã gồm luật) của @duckduckgo/autoconsent.
// Giấy phép MPL-2.0: giữ nguyên file gốc, kèm giấy phép (src/generated/AUTOCONSENT-LICENSE.txt).
// Chạy lại sau khi nâng phiên bản: node scripts/gen-autoconsent.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const dir = 'node_modules/@duckduckgo/autoconsent';
const pkg = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8'));
const js = readFileSync(`${dir}/dist/autoconsent.standalone.js`, 'utf8');
writeFileSync('src/generated/AUTOCONSENT-LICENSE.txt', readFileSync(`${dir}/LICENSE`, 'utf8'));
writeFileSync(
  'src/generated/autoconsent.ts',
  `// TỰ SINH bởi scripts/gen-autoconsent.mjs — đừng sửa tay.\n// @duckduckgo/autoconsent ${pkg.version} (MPL-2.0, mã nguồn: https://github.com/duckduckgo/autoconsent)\nexport const AUTOCONSENT_VERSION = ${JSON.stringify(pkg.version)};\nexport const AUTOCONSENT_JS = ${JSON.stringify(js)};\n`,
);
console.log('autoconsent', pkg.version, (js.length / 1024).toFixed(0) + ' KB');
