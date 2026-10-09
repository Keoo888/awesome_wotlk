// Контракт «аддон <-> dll» для AwesomeCVar: ни одной строки без переменной dll и ни одной переменной
// dll без строки. Числа (вилки, клампы, зарегистрированные дефолты) вытаскиваются из *.cpp, а не из
// памяти -- это и есть смысл гейта.
//
//   node tools/run_cvar_contract.js
//
// Что проверяется:
//   1. множество CVar'ов, которые реально зовёт Console::RegisterCVar (grep по registerCVar в *.cpp);
//   2. множество строк ACVar.CVARS в аддоне;
//   3. для каждой поддерживаемой строки -- вилка/шаг/дефолт против клампа dll, наличие desc и awNeeds.
// Вилка ползунка НЕ имеет права выходить за кламп dll (иначе значение обрежется молча); сужение
// допустимо и печатается отдельной строкой (так сделано у cameraFov).

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'src', 'AwesomeWotlkLib');
// Строки окна живут в двух местах: категории CVar'ов в Constants.lua и вкладка Distance (у неё свои
// виджеты, и единственный CVar объявлен там) в DistancePanel.lua. Контракт обязан видеть оба файла,
// иначе переменная dll останется без контроля, а гейт об этом молча сообщит «строк меньше».
const luaFile = (f) => fs.readFileSync(path.join(root, 'addons', 'AwesomeCVar', f), 'utf8');
const lua = luaFile('Constants.lua') + '\n' + luaFile('DistancePanel.lua');

const read = (f) => fs.readFileSync(path.join(srcDir, f), 'utf8');
const src = {
  NamePlates: read('NamePlates.cpp'),
  Camera: read('Camera.cpp'),
  Interact: read('Interact.cpp'),
  Misc: read('Misc.cpp'),
};

function num(s, re, what) {
  const m = s.match(re);
  if (!m) { console.log('FAIL: гейт не смог вычитать ' + what + ' -- обнови tools/run_cvar_contract.js'); process.exit(1); }
  return parseFloat(m[1]);
}

// --- 1. что регистрирует dll --------------------------------------------------
const registered = new Set();
for (const [file, text] of Object.entries(src)) {
  for (const m of text.matchAll(/registerCVar\(&[A-Za-z_]\w*(?:\[\d+\])?,\s*"([^"]+)"/g)) registered.add(m[1]);
}

// Клампы, которые dll применяет к строке при полле. Без них контракт невозможен: новый CVar обязан
// появиться и здесь.
const regDefault = (text, name) => num(text, new RegExp('"' + name + '", *(?:NULL|nullptr), *[^,]+, *"(-?[0-9.]+)"'), name + ' зарегистрированный дефолт');

const clamp = {
  nameplateDistance: {
    min: num(src.NamePlates, /if \(f < (\d+)\.\) f = \d+\./, 'nameplateDistance min'),
    max: num(src.NamePlates, /if \(f > (\d+)\.\) f = \d+\./, 'nameplateDistance max'),
    def: regDefault(src.NamePlates, 'nameplateDistance'),
  },
  cameraIndirectAlpha: {
    min: num(src.Camera, /if \(a < ([\d.]+)f\) a = [\d.]+f;/, 'cameraIndirectAlpha min'),
    max: num(src.Camera, /if \(a > ([\d.]+)f\) a = [\d.]+f;/, 'cameraIndirectAlpha max'),
    def: regDefault(src.Camera, 'cameraIndirectAlpha'),
  },
  cameraIndirectVisibility: { min: 0, max: 1, def: regDefault(src.Camera, 'cameraIndirectVisibility') },
  interactionAngle: {
    min: num(src.Interact, /if \(a < (\d+)\) a = \d+;/, 'interactionAngle min'),
    max: num(src.Interact, /if \(a > (\d+)\) a = \d+;/, 'interactionAngle max'),
    def: regDefault(src.Interact, 'interactionAngle'),
  },
  interactionMode: { min: 0, max: 1, def: regDefault(src.Interact, 'interactionMode') },
  cameraFov: {
    min: num(src.Misc, /if \(degrees < (\d+)\) degrees = \d+;/, 'cameraFov min'),
    max: num(src.Misc, /if \(degrees > (\d+)\) degrees = \d+;/, 'cameraFov max'),
    def: regDefault(src.Misc, 'cameraFov'),
  },
  // Единственная CVar дистанции: «считать ли ярды». Внешний вид цифр живёт в AWDistanceDB и сверяется
  // гейтом поведения с CLAMPS самой рисовалки, а не с этим контрактом.
  distanceDisplay: { min: 0, max: 1, def: regDefault(src.NamePlates, 'distanceDisplay') },
};


// --- 2. что показывает аддон --------------------------------------------------
const rows = {};
for (const m of lua.matchAll(/\{\s*name = "([a-zA-Z_]+)"[^\n]*\}/g)) {
  const line = m[0];
  const name = m[1];
  if (/type = "description"/.test(line)) continue;
  rows[name] = line;
}

// --- 3. сверка ------------------------------------------------------------
let bad = 0;
console.log('dll регистрирует (' + registered.size + '):   ' + [...registered].sort().join(', '));
console.log('строк в аддоне (' + Object.keys(rows).length + '):  ' + Object.keys(rows).sort().join(', '));

for (const name of Object.keys(rows).sort()) {
  if (!registered.has(name)) { bad++; console.log('FAIL ' + name + ': строка есть, а переменной dll нет -- 3.3.5 заведёт её в Config.wtf и она ничего не будет делать'); }
}
for (const name of [...registered].sort()) {
  if (!rows[name]) { bad++; console.log('FAIL ' + name + ': dll регистрирует, а в аддоне строки нет -- настраивать её нечем'); }
  if (!clamp[name]) { bad++; console.log('FAIL ' + name + ': у гейта нет клампа dll для этой переменной -- добавь его в tools/run_cvar_contract.js'); }
}

for (const name of Object.keys(rows).sort()) {
  const line = rows[name];
  const exp = clamp[name];
  if (!exp) continue;
  const g = (k) => {
    const m = line.match(new RegExp(k + ' *= *("[^"]*"|-?[0-9.]+|true|false)'));
    return m ? m[1].replace(/"/g, '') : undefined;
  };
  const row = {
    type: g('type'),
    min: parseFloat(g('min')), max: parseFloat(g('max')),
    step: parseFloat(g('step')), def: parseFloat(g('default')),
    needs: g('awNeeds'),
    // описание обязано быть: строка без объяснения в окне -- это декорация. Берём его либо из локалей
    // аддона (L.*), либо из собственной таблички строк панели (T.*), которую она держит для вкладки
    // Distance: у той два языка, а не девять локалей.
    hasDesc: /desc = (?:L\.\w+|T\.\w+|"[^"]*")/.test(line),
  };
  const problems = [];
  if (row.type === 'mode') {
    const values = [...line.matchAll(/value *= *(-?[0-9]+)/g)].map((m) => parseInt(m[1], 10));
    if (!values.length) problems.push('type = mode без modes');
    if (!isNaN(row.def) && !values.includes(row.def)) problems.push('default ' + row.def + ' нет среди modes [' + values.join('/') + ']');
    if (values.some((v) => v < exp.min || v > exp.max)) problems.push('modes вне клампа dll [' + exp.min + '..' + exp.max + ']');
  } else {
    if (isNaN(row.min) || isNaN(row.max)) problems.push('нет min/max');
    if (isNaN(row.def)) problems.push('нет numeric default');
    if (row.min < exp.min || row.max > exp.max) problems.push('[' + row.min + '..' + row.max + '] шире клампа dll [' + exp.min + '..' + exp.max + '] -- ползунок пустит значение, которое dll обрежет');
    if (row.def !== exp.def) problems.push('default ' + row.def + ' != зарегистрированный dll ' + exp.def);
    if (row.type === 'slider' && isNaN(row.step)) problems.push('slider без step');
  }
  if (!row.needs) problems.push('нет awNeeds (не сказать, каким ключом профиля сборки это включается)');
  if (!row.hasDesc) problems.push('нет desc');

  const narrowed = row.type !== 'mode' && !isNaN(row.min) && (row.min > exp.min || row.max < exp.max)
    ? ' (сужено до [' + row.min + '..' + row.max + '] из клампа dll [' + exp.min + '..' + exp.max + '])' : '';
  if (problems.length) { bad++; console.log('FAIL ' + name + ': ' + problems.join('; ')); }
  else console.log('OK   ' + name + ' ' + row.type + narrowed + ' [' + row.min + '..' + row.max + '] step=' + (isNaN(row.step) ? '-' : row.step) + ' default=' + row.def + ', awNeeds=' + row.needs);
}

console.log(bad ? 'Контракт: ПРОВАЛ (' + bad + ')'
  : 'Контракт: зелёный -- ' + Object.keys(rows).length + ' строк против клампов dll');
process.exit(bad ? 1 : 0);
