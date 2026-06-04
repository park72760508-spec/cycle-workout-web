const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '../assets/js/journal/journalTransparentShare.js');
let c = fs.readFileSync(p, 'utf8');

c = c.replace(
  /if \(method === 'bridge-open'\) \{[\s\S]*?showToast\('저장 페이지를 열 수 없습니다\. 다시 시도해 주세요\.', 'error'\);\s*\}/,
  "if (method === 'bridge-open' || method === 'browser-open') { return; }\n            setStatus('저장 도우미를 열 수 없습니다. 다시 시도해 주세요.', true);"
);

c = c.replace(
  /if \(inApp\) \{\s*setStatus\(\s*'사진첩 저장에 실패했습니다[^']*',\s*true\s*\);[\s\S]*?return;\s*\}/,
  "if (inApp) { setStatus('저장 도우미에서 버튼을 눌러 저장을 완료해 주세요.', true); return; }"
);

c = c.replace(/Google 포oto/g, 'Google 포토');

fs.writeFileSync(p, c, 'utf8');
console.log('patched');
