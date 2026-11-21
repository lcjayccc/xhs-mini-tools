// 用法：node tools/check-protected.mjs <基线 app.js> <候选 app.js>
// 例：git show HEAD:darkroom/app.js > base.js && node tools/check-protected.mjs base.js darkroom/app.js
// 比对 Claude 维护的函数（去掉空白后逐字相同）、几处受保护的单行和常量，并做 ES2017 / 禁用 API 红线扫描。
// 落地 Gemini 输出前必跑；Claude 自己有意改了受保护函数时，用改后的版本作基线。
import fs from 'node:fs';

const [base, cand] = process.argv.slice(2).map((p) => fs.readFileSync(p, 'utf8'));
const FUNCS = ['pickMaterial', 'collectMaterial', 'persist', 'saveCount', 'saveCards', 'refreshCollectionViews',
  'loadSaved', 'lightsOn', 'bindTrayRub', 'bindFix', 'startDevelop', 'stopDevelopLoop', 'stopAllGyro',
  'startCardGyro', 'stopCardGyro', 'ensureCardShot', 'saveCard', 'releaseBusy', 'again', 'savePhoto', 'postNote',
  'bindAgainConfirm'];
const LINES = ['cardState.openSeq = (cardState.openSeq || 0) + 1;', 'saveBtn.disabled = state.busy;',
  'state.shotNo || state.count', 'stopCardGyro();   // 卡册挡住小卡时不再采集', 'if (cardState.open) { startCardLoop(); startCardGyro(); }'];
const CONSTS = ['MATERIALS', 'PRISM_ROLL', 'CARDS_KEY', 'COUNT_KEY', 'BASE_RATE', 'AGITATE_RATE', 'FIX_SECONDS'];

function body(src, name) {
  const m = new RegExp('function ' + name + '\\s*\\(').exec(src);
  if (!m) return null;
  let i = src.indexOf('{', m.index), depth = 0, j = i;
  for (; j < src.length; j += 1) {
    if (src[j] === '{') depth += 1;
    else if (src[j] === '}') { depth -= 1; if (!depth) break; }
  }
  return src.slice(m.index, j + 1).replace(/\s+/g, '');
}
function constLine(src, name) {
  const m = new RegExp('var ' + name + ' = [^;]+;').exec(src);
  return m && m[0];
}

let bad = 0;
for (const f of FUNCS) {
  const a = body(base, f), b = body(cand, f);
  const ok = a !== null && a === b;
  if (!ok) bad += 1;
  console.log((ok ? 'OK   ' : 'DIFF ') + f + (b === null ? '（候选里找不到）' : ''));
}
for (const l of LINES) {
  const ok = cand.includes(l);
  if (!ok) bad += 1;
  console.log((ok ? 'OK   ' : 'MISS ') + l);
}
for (const c of CONSTS) {
  const ok = constLine(base, c) === constLine(cand, c);
  if (!ok) bad += 1;
  console.log((ok ? 'OK   ' : 'DIFF ') + 'const ' + c);
}
const red = [/\?\./, /\?\?/, /\{\s*\.\.\./, /\bfetch\(/, /XMLHttpRequest/, /localStorage/, /\beval\(/, /new Function/, /conic-gradient/];
// 去掉注释和字符串字面量再扫，免得文案里的「???」被当成 ??
const code = cand.replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, "''")
  .replace(/\/\/.*$/gm, '');
for (const r of red) if (r.test(code)) { bad += 1; console.log('RED  ' + r); }
console.log(bad ? `\n${bad} 项不一致` : '\n全部一致');
process.exit(bad ? 1 : 0);
