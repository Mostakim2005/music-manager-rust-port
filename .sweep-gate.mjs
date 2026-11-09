import fs from 'node:fs';
import path from 'node:path';

const CJK = /[\u4e00-\u9fa5]/;
const exts = ['.ts', '.vue', '.css', '.html'];
// Deliberate CJK exemptions. Rationale: docs/REMOVED_FEATURES.md §7.
const skipPrefixes = [
  'src/i18n/lang/', // locale bundle data
  'src/shared/transliteration.ts', // pinyin / kana / bangla romanisation tables
  'src/renderer/utils/lxListParser.ts' // HEADER_KEYWORD_RE matches CJK/KO/JA column headers
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'dist' || entry.name === 'node_modules') continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (exts.includes(path.extname(entry.name))) out.push(p);
  }
  return out;
}

let total = 0;
const residual = [];
for (const file of walk('src')) {
  const norm = file.split(path.sep).join('/');
  if (skipPrefixes.some((p) => norm.startsWith(p))) continue;
  fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .forEach((line, i) => {
      if (CJK.test(line)) {
        total += 1;
        residual.push(`${norm}:${i + 1}: ${line.trim()}`);
      }
    });
}

console.log('CJK lines outside the exemption list:', total);
console.log(residual.join('\n'));

// Count what is intentionally exempt.
let zhLines = 0;
let zhFiles = 0;
for (const file of walk('src/i18n/lang')) {
  const n = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => CJK.test(l)).length;
  if (n) {
    zhLines += n;
    zhFiles += 1;
  }
}
const translit = fs
  .readFileSync('src/shared/transliteration.ts', 'utf8')
  .split(/\r?\n/)
  .filter((l) => CJK.test(l)).length;
console.log(`\nexempt: src/i18n/lang/** = ${zhLines} lines in ${zhFiles} files`);
console.log(`exempt: src/shared/transliteration.ts = ${translit} lines`);
