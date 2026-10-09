// Гейт iTargetingFrames вне игры: семь вещей, которые иначе видно только в бою.
//   1) раскладка сетки -- исполняет безопасный сниппет '_itfupdate' на заглушках и сверяет, как
//      расставляются слоты. Сниппет -- строка: луа-гейт проверяет только его синтаксис
//      (run_addon_lint.js, п. 1b), а поведение можно увидеть лишь так -- до игры.
//   2) парсер npcID из guid -- вызов iTF:npcIDFromGUID на замеренных значениях (п. 7.22), плюс
//      негативный контроль тем же набором на прежнем розничном срезе.
//   3) жизненный цикл слота -- модель 3.3.5a менеджера состояний против реальных строк драйвера и
//      обработчика '_onstate-itfN' (п. 7.23): без неё дырка в сетке видна только глазами в бою.
//   4) геометрия фона (п. 7.25): серый прямоугольник mainFrame обязан ровно покрывать клетки, которые
//      расставляет getUFPos, -- при invertGrow и при расхождении трёх копий формулы он этого не делает.
//   5) переполнение рамки по смене юнита (п. 7.29): тот же слот nameplateN может уйти другому юниту без
//      второго NAME_PLATE_UNIT_ADDED, и тогда имя, guid, npcID и цвет класса остаются от прошлого --
//      так Halion ездил под табличкой Chaos Invoker.
//   6) id спеллов в данных аддона (п. 7.31): шестизначного id на этом клиенте не существует,
//      GetSpellInfo на нём отдаёт nil, и условка собирается молча пустой.
//   7) пункт NPC Blacklist в окне настроек и полнота локалей (п. 7.32): без строки в дереве опций до
//      чёрного списка NPC доберётся только слэш-команда, а необъявленный ключ локали -- пустая подпись в UI.
//
//   node tools/run_itf_layout_check.js
//
// Нужен fengari (лежит рядом с MRT, путь переопределяется через AW_FENGARI).

const fs = require('fs');
const path = require('path');

const FENGARI_CANDIDATES = [
  process.env.AW_FENGARI,
  'C:/Games/backport/MRT-3.3.5a/tools/luacheck/node_modules/fengari',
  path.join(__dirname, 'node_modules/fengari'),
].filter(Boolean);
let fengari = null;
for (const c of FENGARI_CANDIDATES) {
  try { fengari = require(c); break; } catch (e) { /* следующий кандидат */ }
}
if (!fengari) {
  console.log('FAIL: fengari не найден. Поставь AW_FENGARI=<путь> или npm i fengari в tools/.');
  process.exit(1);
}
const { lua, lauxlib, lualib, to_luastring } = fengari;

const SRC = process.env.AW_ITF_SRC
  || path.join(__dirname, '..', 'addons', 'iTargetingFrames', 'iTargetingFrames.lua');
const src = fs.readFileSync(SRC, 'utf8');
const raw = (src.match(/SetAttribute\('_itfupdate', string\.format\(\[\[([\s\S]*?)\]\], iTFConfig/) || [])[1];
if (!raw) {
  console.log("FAIL: сниппет '_itfupdate' не извлечён -- изменилась форма вызова, гейт слепнет");
  process.exit(1);
}
const snippet = raw.replace(/%d/g, '60').replace(/'%s'/g, "'BOTTOMRIGHT'");

const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
const harness = `
DENY = {}
SLOTS = {}
iTFUnitPositions = {}
for i = 1, 60 do iTFUnitPositions[i] = {i * 100, i * 200} end
frames = {}
local function mk(name)
  local f = {name = name, cleared = 0}
  f.ClearAllPoints = function(s) s.cleared = s.cleared + 1 end
  f.SetPoint = function(s, grow, parent, anchor, x, y) s.x = x; s.y = y end
  f.Show = function(s) s.shown = true end
  f.Hide = function(s) s.shown = false end
  return f
end
self = {GetFrameRef = function(s, tok)
  if not frames[tok] then frames[tok] = mk(tok) end
  return frames[tok]
end,
-- DENY играет 'itfdenyitfN': так сниппет читает чёрный список NPC (п. 7.32), атрибуты ставит аддон.
-- Отказ на '^_' -- не украшение, а поведение клиента: HANDLE:GetAttribute (RestrictedFrames.lua:188-191)
-- молча отдаёт nil на любое имя с подчёркиванием. Прежний стаб был обычным обращением к таблице, то есть
-- мягче клиента, и пропустил живой дефект 04.10: атрибут '_itfdenyitfN' записан, сниппет его не видит.
GetAttribute = function(s, name)
  if type(name) ~= 'string' or name:sub(1, 1) == '_' then return nil end
  return DENY[name]
end,
-- SetAttribute -- вторая половина той же границы: HANDLE:SetAttribute (RestrictedFrames.lua:507-519)
-- ОТКАЗЫВАЕТСЯ от имени с '_' и от значения-таблицы. Сниппет пишет этим зеркало слотов
-- ('itfslot<токен>' -> число), которое потом читает insecure-код в frameSlot.
SetAttribute = function(s, name, value)
  if type(name) ~= 'string' or name:sub(1, 1) == '_' then error('Invalid attribute name') end
  if type(value) == 'table' then error('Invalid attribute value') end
  DENY[name] = value
  if type(name) == 'string' and name:sub(1, 7) == 'itfslot' then SLOTS[name:sub(8)] = value end
end,
-- control -- то же имя видит и 3.3.5a в среде сниппетов (Cell NoM0Re использует control:RunAttribute),
-- RunAttribute нужен обработчику '_onstate', который зовёт control:RunAttribute('_itfupdate')
RunAttribute = function(s) SNIP() end}
control = self
SNIP = function()
${snippet}
end
`;
if (lauxlib.luaL_dostring(L, to_luastring(harness)) !== lua.LUA_OK) {
  console.log('FAIL: harness не загрузился:', lua.lua_tojsstring(L, -1));
  process.exit(1);
}

function getString(name) {
  lua.lua_getglobal(L, to_luastring(name));
  const v = lua.lua_tojsstring(L, -1);
  lua.lua_pop(L, 1);
  return v;
}
function getNumber(name) {
  lua.lua_getglobal(L, to_luastring(name));
  const v = lua.lua_tonumber(L, -1);
  lua.lua_pop(L, 1);
  return v;
}
function doString(code) { lauxlib.luaL_dostring(L, to_luastring(code)); }

// '_itfupdate' собирается с подстановкой maxUnits в оба цикла -- на 60 он один, а проверка ниже
// должна уметь увидеть и сетку поменьше (игрок ставит 1..40, options.lua:940-952)
const madeSnippets = new Set();
function ensureSnippet(n) {
  if (madeSnippets.has(n)) return;
  const s = raw.replace(/%d/g, String(n)).replace(/'%s'/g, "'BOTTOMRIGHT'");
  doString(`SNIP_${n} = function()\n${s}\nend`);
  madeSnippets.add(n);
}

let failures = 0, checks = 0;

function scenario(name, alive, showing, expect, deny) {
  checks++;
  const setup = ['iTFCurrentlyAlive = {}', 'iTFCurrentlyShowing = {}', 'DENY = {}', 'SLOTS = {}']
    .concat(Object.entries(alive).map(([k, v]) => `iTFCurrentlyAlive["${k}"] = ${v}`))
    .concat(Object.entries(showing).map(([k, v]) => `iTFCurrentlyShowing[${k}] = "${v}"`))
    // токен в iTFCurrentlyShowing по смыслу уже на экране -- иначе проверка "скрыт/показан" врёт:
    // фреймы в модели появляются только через GetFrameRef, а Show() сниппет зовёт лишь при раздаче
    .concat(Object.values(showing).map((v) => `self:GetFrameRef("${v}").shown = true`))
    .concat((deny || []).map((tok) => `DENY["itfdeny${tok}"] = 1`));
  doString(setup.join('\n') + "\nERR = tostring((select(2, pcall(SNIP))) or '')");
  const err = getString('ERR');
  if (err && err !== 'nil' && err !== 'false') {
    console.log(`FAIL ${name}: сниппет упал -> ${err}`);
    failures++;
    return;
  }
  const parts = [];
  let ok = true;
  for (const [slot, want] of Object.entries(expect.showing)) {
    doString(`V = iTFCurrentlyShowing[${slot}] or ''`);
    const got = getString('V');
    if (got !== want) ok = false;
    parts.push(`${slot}=${got || '_'}`);
  }
  for (const [tok, want] of Object.entries(expect.alive)) {
    doString(`V2 = iTFCurrentlyAlive["${tok}"] or -1`);
    const got = getNumber('V2');
    if (got !== want) ok = false;
    parts.push(`${tok}->${got}`);
  }
  // показан ли фрейм: чёрный список обязан не только освободить клетку, но и спрятать рамку
  for (const tok of (expect.hidden || [])) {
    doString(`H = tostring(frames["${tok}"] and frames["${tok}"].shown)`);
    const got = getString('H');
    if (got !== 'false' && got !== 'nil') ok = false;
    parts.push(`скрыт(${tok})=${got === 'false' || got === 'nil' ? 'да' : got}`);
  }
  for (const tok of (expect.visible || [])) {
    doString(`V3 = tostring(frames["${tok}"] and frames["${tok}"].shown)`);
    const got = getString('V3');
    if (got !== 'true') ok = false;
    parts.push(`показан(${tok})=${got}`);
  }
  // зеркало слотов: то, что insecure-код увидит атрибутом. Сверяется по КАЖДОМУ токену из alive,
  // поэтому переименование на одной из сторон (писатель в сниппете и читатель в frameSlot) даёт FAIL сразу
  for (const [tok, want] of Object.entries(expect.mirror || {})) {
    doString(`M = SLOTS["${tok}"] or -1`);
    const got = getNumber('M');
    if (got !== want) ok = false;
    parts.push(`зеркало(${tok})=${got}`);
  }
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${parts.join(' ')}`);
}

// 1) умер occupant слота 3: показанное стягивается в 1..3, новый плейт садится в 4, а не в дырку
scenario('дырка в середине закрывается, новый плейт берёт следующий слот',
  { itf1: 1, itf2: 2, itf4: 4, itf5: 0 },
  { 1: 'itf1', 2: 'itf2', 4: 'itf4' },
  { showing: { 1: 'itf1', 2: 'itf2', 3: 'itf4', 4: 'itf5' },
    alive: { itf1: 1, itf2: 2, itf4: 3, itf5: 4 },
    mirror: { itf1: 1, itf2: 2, itf4: 3, itf5: 4 } });

scenario('плотная сетка не переставляется',
  { itf1: 1, itf2: 2, itf3: 3 },
  { 1: 'itf1', 2: 'itf2', 3: 'itf3' },
  { showing: { 1: 'itf1', 2: 'itf2', 3: 'itf3' }, alive: { itf1: 1, itf2: 2, itf3: 3 } });

scenario('пустой хвост остаётся пустым',
  { itf1: 1, itf2: 2 },
  { 1: 'itf1', 2: 'itf2' },
  { showing: { 1: 'itf1', 2: 'itf2', 3: '' }, alive: { itf1: 1, itf2: 2 } });

// чёрный список NPC (п. 7.32): запретный токен освобождает клетку, прячется и не проталкивается в
// свободный слот, а при снятии запрета возвращается в сетку -- всё это решает сам сниппет по атрибуту
scenario('чёрный список в середине: itf2 освобождает клетку и прячется, itf3 сдвигается на 2',
  { itf1: 1, itf2: 2, itf3: 3 },
  { 1: 'itf1', 2: 'itf2', 3: 'itf3' },
  { showing: { 1: 'itf1', 2: 'itf3', 3: '' }, alive: { itf1: 1, itf2: 0, itf3: 2 },
    hidden: ['itf2'], visible: ['itf1', 'itf3'] },
  ['itf2']);

scenario('запрещённый токен не занимает свободную клетку',
  { itf1: 1, itf2: 0 },
  { 1: 'itf1' },
  { showing: { 1: 'itf1', 2: '' }, alive: { itf2: 0 }, hidden: ['itf2'], visible: ['itf1'] },
  ['itf2']);

scenario('снятие запрета возвращает рамку в сетку',
  { itf1: 1, itf2: 0 },
  { 1: 'itf1' },
  { showing: { 1: 'itf1', 2: 'itf2' }, alive: { itf2: 2 }, visible: ['itf1', 'itf2'] });

// негативный контроль: без цикла стяжки та же ситуация оставляет пустую клетку между занятыми -- иначе
// позитивные сценарии ничего не доказывают
const noCompact = snippet.replace(/local writeSlot = 1[\s\S]*?\n\t\tend\n/, '');
if (noCompact === snippet) {
  console.log('FAIL: не удалось вырезать цикл стяжки -- негативный контроль бесполезен');
  failures++;
  checks++;
} else {
  doString(`SNIP_BROKEN = function()\n${noCompact}\nend`);
  doString(`iTFCurrentlyAlive = {itf1=1, itf2=2, itf4=4}
iTFCurrentlyShowing = {[1]='itf1', [2]='itf2', [4]='itf4'}
pcall(SNIP_BROKEN)
VB3 = iTFCurrentlyShowing[3] or ''
VB4 = iTFCurrentlyShowing[4] or ''`);
  checks++;
  const s3 = getString('VB3'), s4 = getString('VB4');
  const caught = s3 === '' && s4 === 'itf4';
  if (!caught) failures++;
  console.log(`${caught ? 'ok  ' : 'FAIL'} негатив (без стяжки): слот 3 = ${JSON.stringify(s3)}, слот 4 = ${JSON.stringify(s4)}` +
    (caught ? ' -- пустая клетка между занятыми остаётся, гейт ловит именно это' : ' -- гейт ничего не доказывает'));
}

// 5) парсер npcID из guid. Раскладка измерена (docs/TECHNICAL.md, п. 7.22: Warmane-комбатлог 8 858 656
// строк и 2 708 698 guid), поэтому проверяем её на настоящих значениях, а не на сочинённых.
const fnSrc = (src.match(/function iTF:npcIDFromGUID\(guid\)[\s\S]*?\nend\n/) || [])[0];
if (!fnSrc) {
  console.log('FAIL: iTF:npcIDFromGUID не извлечён из исходника -- изменилась форма, гейт слепнет');
  failures++;
  checks++;
} else {
  doString('iTF = {}\n' + fnSrc);
  const CASES = [
    ["'0xF1300077D8000049'", '30680', 'Onyx Brood General (существо)'],
    ["'F1300077D8000049'", '30680', 'тот же guid без 0x -- ответ не должен меняться'],
    ["'0xf1300077d8000049'", '30680', 'нижний регистр префикса и цифр'],
    ["'0xF1405920130248F3'", '5840915', 'Chimaera (пет) -- здесь старый срез ошибался'],
    ["'0xF11002BEE8000006'", '179944', 'Meeting Stone (геймобъект)'],
    ["'0x0E000000000A7C47'", '0', 'игрок: поле существа нулевое'],
    ['nil', 'nil', 'nil вместо строки (юнит исчез) -- не должно падать'],
    ["''", 'nil', 'пустая строка -- не должно падать'],
  ];
  for (const [input, want, label] of CASES) {
    checks++;
    doString("R = 'NORESULT'\nlocal ok, v = pcall(function() return iTF:npcIDFromGUID(" + input + ") end)\nR = ok and tostring(v) or ('ПАДЕНИЕ: ' .. tostring(v))");
    const got = getString('R');
    if (got !== want) failures++;
    console.log(`${got === want ? 'ok  ' : 'FAIL'} npcID ${input}: ${got}` + (got === want ? '' : ` (ожидалось ${want}) -- ${label}`));
  }
  // негативный контроль: тот же набор на прежнем розничном срезе sub(8,12). Если он даёт те же ответы,
  // значит проверка ничего не доказывает.
  doString(`OLD = function(guid) return tostring(tonumber(string.sub(guid, 8, 12), 16)) end
O1 = OLD('0xF1405920130248F3')
O2 = OLD('F1300077D8000049')`);
  checks++;
  const o1 = getString('O1'), o2 = getString('O2');
  const differs = o1 !== '5840915' && o2 !== '30680';
  if (!differs) failures++;
  console.log(`${differs ? 'ok  ' : 'FAIL'} негатив (старый sub(8,12)): пет = ${o1} вместо 5840915, guid без 0x = ${o2} вместо 30680` +
    (differs ? ' -- новый парсер ловит ровно это' : ' -- проверка пустая'));
}

// 6) Жизненный цикл слота: модель 3.3.5a SecureStateDriverManager против настоящих строк аддона.
//    Модель не выдумана, а собрана из FrameXML 3.3.5a (копия справочника, строки указаны):
//      SecureStateDriver.lua:89-101  --newValue = SecureCmdOptionParse(values); ...
//                                       if (newValue and newValue ~= oldValue) then SetAttribute end
//      SecureStateDriver.lua:139-151 -- то же самое синхронно внутри RegisterStateDriver
//      SecureHandlers.lua:166-170    -- _onstate-X выполняется ТОЛЬКО если атрибут '_onstate-X' уже есть
//    Отсюда два способа получить дырку в сетке, и оба проверяются ниже на реальном исходнике.
//    Живая ветка -- вторая: configMode-цикл (первый) в аддоне закомментирован в месте вызова и не
//    выполняется никогда, поэтому проверяем именно вторую регистрацию драйвера.
const allRegs = src.match(/RegisterStateDriver\(iTF\.mainFrame, 'itf'\.\.i, (.+?)\)\s*\n/g) || [];
const liveLine = ((allRegs.pop() || '')
  .replace(/^RegisterStateDriver\(iTF\.mainFrame, 'itf'\.\.i, /, '')
  .replace(/\)\s*$/, ''));
const onstateBody = (src.match(/iTF\.mainFrame:SetAttribute\('_onstate-itf'\.\.i,\[=\[([\s\S]*?)\]=\]\)/g) || []).pop();
if (!liveLine || !onstateBody) {
  console.log('FAIL: не извлечены строки state-драйвера -- гейт слепнет');
  failures++; checks++;
} else {
  const body = onstateBody.replace(/^iTF\.mainFrame:SetAttribute\('_onstate-itf'\.\.i,\[=\[/, '').replace(/\]=\]\)$/, '');
  doString(`ONSTATE = function(stateid, newstate)
${body}
end`);

  //_lua_: снять состояние машины в одну строку для разбора в JS
  const DUMP_LUA = `D = {}
for i = 1, 60 do local t = iTFCurrentlyShowing[i]; if t then D[#D+1] = 'S'..i..'='..t end end
for k, v in pairs(iTFCurrentlyAlive) do D[#D+1] = 'A'..k..'='..tostring(v) end
for k, f in pairs(frames) do D[#D+1] = 'V'..k..'='..tostring(f.shown and 1 or 0) end
DUMP = table.concat(D, ' ')`;

  // Lua-выражение условия из исходника -> готовая строка драйвера для индекса i
  function condFor(i, conds) {
    let out = '';
    for (const p of liveLine.split('..')) {
      const q = p.match(/^'(.*)'$/);
      if (q) out += q[1];
      else if (p.trim() === 'i') out += String(i);
      else if (p.trim() === 'conds') out += conds;
      else { out = null; break; }
    }
    if (out === null) throw new Error('не разобрал выражение условия: ' + liveLine);
    return out;
  }
  function branches(cond) {
    const m = cond.match(/^\[([^\]]*)\]([^\[]*?);(.*)$/);
    if (!m) return null;
    return { clauses: m[1], yes: m[2].trim(), no: m[3].trim() };
  }
  // '[@nameplateN, exists, nodead]' -> ['exists','nodead']
  function clauses(cond) {
    const m = cond.match(/^\[([^\]]*)\]/);
    if (!m) return null;
    return m[1].split(',').map(s => s.trim()).filter(s => s && s[0] !== '@');
  }
  function holds(list, st) {
    for (const c of list) {
      if (c === 'exists' && !st.exists) return false;
      if (c === 'nodead' && !(st.exists && !st.dead)) return false;
      if (c === 'dead' && !(st.exists && st.dead)) return false;
      if (c === 'combat' && !st.combat) return false;
      if (c === 'harm' && !st.harm) return false;
    }
    return true;
  }

  // sem: 'nil'   -- пустой false-ветка даёт nil (тогда переход в false НЕ доставляется, рамка
  //                 остаётся занимать слот: это и есть несмываемая дырка)
  //      'empty' -- пустой false-ветка даёт '' (тогда всё работает и без явного false)
  // Источник порядка установки обработчика -- исходник аддона (живая ветка: последние вхождения
  // обеих строк в updateNameplateStateDrivers), а не наше предположение.
  const regAt = src.lastIndexOf("RegisterStateDriver(iTF.mainFrame, 'itf'..i");
  const installAt = src.lastIndexOf("_onstate-itf'..i");
  const installFirstSrc = installAt < regAt;

  function sim(opt) {
    const units = {};
    for (let i = 1; i <= 60; i++) units[i] = { exists: false, dead: false, combat: true, harm: true };
    const attrs = {}, installed = {}, errors = [];
    const cond = condFor(1, ''), br = branches(cond), cl = clauses(cond);
    if (!br || !cl) { errors.push('условие драйвера не разобрано: ' + cond); return { units, errors }; }
    const maxU = opt.maxUnits || 60;
    ensureSnippet(maxU);
    doString('SNIP = SNIP_' + maxU);

    // один шаг менеджера состояний для одного индекса; registerPass = вызов внутри RegisterStateDriver
    function fire(i, registerPass) {
      if (registerPass && installFirstSrc) installed[i] = true;
      const val = holds(cl, units[i]) ? br.yes : (br.no === '' ? (opt.sem === 'nil' ? null : '') : br.no);
      if (val !== null && val !== undefined && val !== attrs[i]) {
        attrs[i] = val;
        if (installed[i]) {
          doString(`ERRS = tostring((select(2, pcall(ONSTATE, 'itf${i}', '${val}'))) or '')`);
          const e = getString('ERRS');
          if (e && e !== 'nil' && e !== 'false') errors.push(`itf${i} newstate='${val}' -> ${e}`);
        } else if (registerPass) {
          errors.push(`itf${i}: переход в '${val}' потерян, _onstate ещё не установлен`);
        }
      }
      if (registerPass && !installFirstSrc) installed[i] = true;
    }

    doString(`iTFCurrentlyAlive = {}\niTFCurrentlyShowing = {}
for k in pairs(frames) do frames[k].shown = nil end`);
    for (let i = 1; i <= 60; i++) fire(i, true);
    for (const step of opt.steps) {
      for (const idx of step.plates || []) Object.assign(units[idx], step.set || {});
      for (let i = 1; i <= 60; i++) fire(i, false);
    }
    doString(DUMP_LUA);
    return { dump: getString('DUMP'), errors, units, br };
  }

  function parse(dump) {
    const showing = {}, alive = {}, shown = {};
    for (const tok of (dump || '').split(' ')) {
      const m = tok.match(/^([SAV])?([^=]*)=(.*)$/);
      if (!m || !m[1]) continue;
      if (m[1] === 'S') showing[Number(m[2])] = m[3];
      else if (m[1] === 'A') alive[m[2]] = m[3];
      else shown[m[2]] = m[3] === '1';
    }
    return { showing, alive, shown };
  }
  function capErrors(list) {
    if (list.length <= 3) return list.slice();
    return list.slice(0, 3).concat([`... и ещё ${list.length - 3} таких же`]);
  }
  function report(name, st, units, bad) {
    checks++;
    if (bad.length) {
      failures++;
      const cut = bad.length > 4 ? bad.slice(0, 4).concat([`... и ещё ${bad.length - 4}`]) : bad;
      const who = cut.map(b => JSON.stringify(b)).join(', ');
      const slots = Object.entries(st.showing).sort((a, b) => a[0] - b[0]).map(([i, t]) => `${i}:${t}`).join(' ');
      console.log(`FAIL ${name}: ${who}\n       слоты: ${slots || '_'}` +
        `\n       на экране: ${Object.entries(units).filter(([, u]) => u.exists && !u.dead).map(([i]) => 'itf' + i).join(' ') || '_'}`);
    } else {
      console.log(`ok   ${name}`);
    }
  }

  // Что игрок видит глазами и что обязано выполняться после ЛЮБОЙ последовательности переходов:
  //   1) в занятом слоте стоит живой плейт;  2) внутри 1..n нет пустой клетки (это и есть «дырка»);
  //   3) показанных слотов ровно min(maxUnits, живых) -- ни меньше (плейт потерялся), ни больше (сверх лимита);
  //   4) слот занят -> рамка показана;  5) мёртвый плейт не остаётся ни в слоте, ни в очереди;
  //   6) живой плейт не ждёт в очереди, если свободные слоты есть.
  function invariants(st, r, maxU) {
    const bad = capErrors(r.errors);
    const units_of = (tok) => r.units[Number(tok.slice(3))];
    const live = Object.values(r.units).filter(u => u.exists && !u.dead).length;
    const n = Object.keys(st.showing).length;
    for (const [i, tok] of Object.entries(st.showing)) {
      const u = units_of(tok);
      if (u && (!u.exists || u.dead)) bad.push(`слот ${i} держит ${tok}, которого нет в живых`);
      if (!st.shown[tok]) bad.push(`слот ${i} чисится занятым ${tok}, а рамка не показана`);
    }
    for (let i = 1; i <= n; i++) if (!st.showing[i]) bad.push(`внутри 1..${n} пустая клетка ${i}`);
    if (n !== Math.min(maxU, live)) bad.push(`на экране ${n} слотов при ${live} живых и maxUnits=${maxU} (ожидалось ${Math.min(maxU, live)})`);
    for (const [tok, v] of Object.entries(st.alive)) {
      const u = units_of(tok);
      if (!u || !u.exists || u.dead) { bad.push(`${tok}=${v} в состоянии после смерти`); continue; }
      if (v === '0' && n < maxU) bad.push(`${tok} жив и ждёт в очереди, хотя свободные слоты есть (${n}/${maxU})`);
    }
    return bad;
  }

  // (a) условие должно иметь непустой false-ветку: иначе переход «плейт умер/исчез» клиент не
  //     доставляет (newValue == nil -> SetAttribute не вызывается) и слот остаётся занятым.
  checks++;
  const noBranch = branches(condFor(1, '')).no === '';
  if (noBranch) failures++;
  console.log(`${noBranch ? 'FAIL' : 'ok  '} условие драйвера '${condFor(1, '')}'` +
    (noBranch ? ' -- false-ветки нет: в 3.3.5a переход обратно не доставляется (SecureStateDriver.lua:99)'
              : ' -- обе ветки заданы явно, переход в false приходит'));

  // (b) обработчик обязан ставиться ДО RegisterStateDriver
  checks++;
  if (!installFirstSrc) failures++;
  console.log(`${installFirstSrc ? 'ok  ' : 'FAIL'} порядок в updateNameplateStateDrivers:` +
    (installFirstSrc ? ' сначала _onstate, потом RegisterStateDriver'
                     : ' RegisterStateDriver раньше _onstate -- первый переход потерян (SecureHandlers.lua:167)'));

  // (b2) SetFrameRef обязан ставиться ДО RegisterStateDriver: регистрация вычисляет условие синхронно,
  //      первый же переход зовёт '_itfupdate', а тот берёт рамку через self:GetFrameRef(stateid).
  //      Без ref получался nil и `f:ClearAllPoints()` рвал сниппет на первом показанном плейте.
  checks++;
  const refAt = src.lastIndexOf("SetFrameRef('itf' .. i");
  const regAtLive = regAt;
  const refFirstSrc = refAt >= 0 && refAt < regAtLive;
  if (!refFirstSrc) failures++;
  console.log(`${refFirstSrc ? 'ok  ' : 'FAIL'} порядок SetFrameRef/RegisterStateDriver:` +
    (refFirstSrc ? ' ref стоит раньше регистрации -- первый переход находит рамку'
                 : (refAt < 0 ? ' SetFrameRef в живой ветке не найден вообще'
                              : ' ref ставится ПОСЛЕ регистрации -- GetFrameRef в момент первого перехода ещё nil')));

  // (c) поведенческая модель: мёртвый плейт обязан освободить слот, живой -- занять
  const SEMS = [['nil', 'пустой false-ветка = nil'], ['empty', 'пустой false-ветка = ""']];
  const DEATH = [
    { plates: [1, 2, 3, 4], set: { exists: true } },
    { plates: [2], set: { dead: true } },
    { plates: [5], set: { exists: true } },
  ];
  for (const [sem, label] of SEMS) {
    const r = sim({ sem, steps: DEATH });
    const st = parse(r.dump);
    const bad = invariants(st, r, 60);
    if (!bad.length && st.showing[4] !== 'itf5') bad.push(`новый плейт itf5 сел не в 4-й слот (факт ${st.showing[4] || 'никуда'})`);
    report(`смерть плейта: семантика '${label}'`, st, r.units, bad);
  }

  // (d) плейт, который уже есть в момент регистрации драйверов, не должен теряться: это ровно тот
  //     случай, когда состояние меняется ДО того, как аддон успел поставить _onstate
  for (const [sem, label] of SEMS) {
    const r = sim({ sem, steps: [{ plates: [3], set: { exists: true } }] });
    const st = parse(r.dump);
    report(`плейт уже виден при регистрации: семантика '${label}'`, st, r.units, invariants(st, r, 60));
  }

  // (e) несколько смертей одним махом (массовая смерть, «умерли 1 и 3 из пяти»): дыра обязана закрыться
  //     по обеим сторонам сразу, а не сдвинуться на один шаг
  const GAP2 = [
    { plates: [1, 2, 3, 4, 5], set: { exists: true } },
    { plates: [1, 3], set: { dead: true } },
  ];
  for (const [sem, label] of SEMS) {
    const r = sim({ sem, steps: GAP2 });
    const st = parse(r.dump);
    const bad = invariants(st, r, 60);
    const who = ['itf2', 'itf4', 'itf5'].map((t, i) => st.showing[i + 1]).join(',');
    if (!bad.length && who !== 'itf2,itf4,itf5') bad.push(`после двух смертей слоты 1..3 = ${who}`);
    report(`две смерти сразу: семантика '${label}'`, st, r.units, bad);
  }

  // (f) плейтов больше, чем слотов (8 при maxUnits=6), и часть из них умирает: сетка обязана
  //     остаться плотной на 1..6, а освободившийся слот -- закрыть очередью живых. Здесь же
  //     проверяется, что стяжка не выходит за maxUnits (слайдер 1..40, options.lua:940-952).
  const SURPLUS = [
    { plates: [1, 2, 3, 4, 5, 6, 7, 8], set: { exists: true } },
    { plates: [2, 4], set: { dead: true } },
  ];
  for (const [sem, label] of SEMS) {
    const r = sim({ sem, steps: SURPLUS, maxUnits: 6 });
    const st = parse(r.dump);
    report(`8 плейтов при maxUnits=6, умерли 2 и 4: семантика '${label}'`, st, r.units, invariants(st, r, 6));
  }
}

// (g) Геометрия сетки: серый фон mainFrame обязан ровно покрывать те клетки, в которые сниппет
//     ставит рамки. Формула фона продублирована трижды (CreateMainFrame, ветки 'size' и 'pos' в
//     updateFrames), а требуемый размер считается здесь по самой getUFPos -- её тело извлекается из
//     исходника, поэтому расхождение любой из трёх копий с реальным шагом сетки тоже ловится.
//     Нужен этот контроль потому, что при invertGrow аддон расставляет рамки colS штук по горизонтали,
//     а прямоугольник рисует как при обычной раскладке (ceil(maxUnits/colS) по горизонтали): превью в
//     окне настроек перестаёт соответствовать сетке, и тем более перестаёт, если копии формулы разъедутся.
const getUFPosSrc = (src.match(/function iTF:getUFPos\(id\)[\s\S]*?\nend\n/) || [])[0];
const BOX_PAIRS = Array.from(src.matchAll(/local width = (.*)\n[ \t]*local height = (.*)/g))
  // хвостовой '--'-комментарий к формуле отрезается: вставляться она будет в скобки, а '--' в Lua
  // дотягивает до конца строки и съел бы закрывающую скобку
  .map((m) => ({ w: m[1].split('--')[0].trim(), h: m[2].split('--')[0].trim() }));
if (!getUFPosSrc) {
  console.log('FAIL: iTF:getUFPos не извлечён из исходника -- гейт слепнет');
  failures++; checks++;
} else if (BOX_PAIRS.length !== 3) {
  console.log(`FAIL: копий формулы фона mainFrame найдено ${BOX_PAIRS.length}, ожидалось 3 ` +
    '(CreateMainFrame, ветка size, ветка pos) -- гейт слепнет');
  failures++; checks++;
} else {
  doString('iTF = {}\niTFConfig = {layout = {frame = {width = 200, height = 60, hspacing = 0, vspacing = 0}}}\n'
    + getUFPosSrc);
  // Требуемый прямоугольник = (максимальный индекс клетки по оси + 1) * шаг по этой оси. Шаг взят
  // равным самой рамке (hspacing/vspacing = 0), поэтому индекс = |координата| / размер.
  function needed(mu, colS, invert) {
    doString(`iTFConfig.layout.maxUnits = ${mu}
iTFConfig.layout.colS = ${colS}
iTFConfig.layout.invertGrow = ${invert ? 'true' : 'nil'}
iTFConfig.layout.grow = 'BOTTOMLEFT'
local mx, my, off = 0, 0, ''
for i = 1, ${mu} do
  local x, y = iTF:getUFPos(i)
  x, y = math.abs(x), math.abs(y)
  local ix, iy = math.floor(x / 200 + 0.5), math.floor(y / 60 + 0.5)
  if ix * 200 ~= x then off = off .. 'x' .. i .. ' ' end
  if iy * 60 ~= y then off = off .. 'y' .. i .. ' ' end
  if x > mx then mx = x end
  if y > my then my = y end
end
NEEDW = (mx / 200 + 1) * 200
NEEDH = (my / 60 + 1) * 60
OFF = off`);
    return { w: getNumber('NEEDW'), h: getNumber('NEEDH'), off: getString('OFF') };
  }
  for (const [mu, cs, inv, label] of [
    [25, 5, false, 'maxUnits=25, colS=5'],
    [8, 5, false, 'maxUnits=8, colS=5'],
    [25, 5, true, 'maxUnits=25, colS=5, invertGrow'],
    [8, 5, true, 'maxUnits=8, colS=5, invertGrow'],
  ]) {
    checks++;
    const nd = needed(mu, cs, inv);
    const got = BOX_PAIRS.map((p) => {
      doString(`BW = (${p.w})\nBH = (${p.h})`);
      return `${getNumber('BW')}x${getNumber('BH')}`;
    });
    const same = got.every((s) => s === got[0]);
    const fits = same && !nd.off && got[0] === `${nd.w}x${nd.h}`;
    if (!fits) failures++;
    console.log(`${fits ? 'ok  ' : 'FAIL'} фон mainFrame (${label}): по getUFPos нужно ${nd.w}x${nd.h}, `
      + `формулы дают ${got.join(' | ')}`
      + (fits ? '' : ` -- ${nd.off ? 'позиции не кратны шагу сетки: ' + nd.off : 'фон не покрывает сетку (или копии формулы разошлись)'}`));
  }
}

// (h) Смена юнита под тем же токеном обязана переполнять рамку. Клиент передаёт тот же nameplateN
//     другому юниту без второго NAME_PLATE_UNIT_ADDED (замерено не у нас -- 02.10 в Ruby Sanctum
//     плашка Halion несла имя предыдущего владельца слота, Chaos Invoker, пока плашка сама не
//     обновилась): здоровье и ауры при этом живые, потому что они опрашиваются по токену, а имя,
//     guid, npcID и цвет класса остаются от прошлого юнита, пока не сработает updateUnitID.
//     Условие переполнения вытаскивается из OnUpdate и исполняется здесь, а не пересказывается.
{
  const callAt = src.indexOf('iTF:updateUnitID(k)');
  const pre = callAt >= 0 ? src.slice(0, callAt) : '';
  // опора на 'not v.customData' ближе к истине, чем на отступ: ветка живёт в глубине вложенности,
  // и число табов слева менялось вместе с правками 02.10
  const anchor = pre.lastIndexOf('not v.customData');
  const ifAt = anchor >= 0 ? pre.lastIndexOf('if ', anchor) : -1;
  const cond = ifAt >= 0
    ? pre.slice(ifAt + 3, callAt).replace(/\s*then\s*$/, '').replace(/\s+/g, ' ').trim()
    : null;
  // Условие опирается на локал, поднятый из цикла (03.10: nameplateAPI() и метод стоили вызова и двух
  // поисков по таблице на каждую из 60 рамок каждый тик). Его инициализация тоже берётся из файла, а не
  // пересказывается здесь, иначе гейт проверял бы собственную выдумку.
  const hoistAt = pre.lastIndexOf('local getPlate');
  const hoist = hoistAt >= 0
    ? pre.slice(hoistAt, pre.indexOf('\n', hoistAt)).replace(/^local\s+/, '').trim()
    : null;
  checks++;
  if (!cond || !hoist) {
    failures++;
    console.log(`FAIL: ${!cond ? 'условие переполнения рамки' : 'подъём getPlate'} в OnUpdate не извлечён -- гейт слепнет`);
  } else {
    doString(`iTF = { updateUnitID = function() CALLS = CALLS + 1 end }\n`
      + `function nameplateAPI() return HAS_DLL end\n`
      + `C_NamePlate = { GetNamePlateForUnit = function() return PLATE end }\n`
      + `function UnitGUID() return LIVE end\n`
      + `k = 'nameplate3'`);
    // [ожидание, подпись случая, customData, сохранённый guid, guid юнита сейчас, плашка есть, шим есть]
    const CASES = [
      [1, 'первое заполнение рамки', false, null, 'A', true, true],
      [0, 'тот же юнит -- не переполнять (нет мигания)', true, 'A', 'A', true, true],
      [1, 'слот перешёл другому юниту -- переполнить (Halion вместо Chaos Invoker)', true, 'A', 'B', true, true],
      [0, 'guid пока nil (юнит на переходе) -- не трогать', true, 'A', null, true, true],
      [0, 'нет шима/плашки -- рамка не заполняется вовсе', false, null, 'A', false, false],
    ];
    const bad = [];
    for (const [want, label, filled, stored, live, plate, dll] of CASES) {
      doString(`CALLS = 0\nHAS_DLL = ${dll}\nPLATE = ${plate ? '{}' : 'nil'}\nLIVE = ${live ? `'${live}'` : 'nil'}\n`
        + `v = {${filled ? ' customData = {},' : ''}${stored ? ` guid = '${stored}',` : ''} }\n`
        + `${hoist}\n`
        + `if (${cond}) then iTF:updateUnitID(k) end\nGOT = CALLS`);
      const got = getNumber('GOT');
      if (got !== want) bad.push(`${label}: ${got} вместо ${want}`);
    }
    if (bad.length) failures++;
    console.log(`${bad.length ? 'FAIL' : 'ok  '} переполнение рамки по смене юнита (${CASES.length} случаев)` +
      (bad.length ? `: ${bad.join('; ')}` : ''));
  }
}

// (i) Числовые id спеллов в данных аддона обязаны помещаться в диапазон 3.3.5a. Класс дефекта пришёл
//     сверху вместе с вендорским кодом: у комбат-разбойника в rangeSpells.lua стоял dps = 193315
//     (Saber Slash, Legion), GetSpellInfo на этом клиенте отдаёт nil, и условка `maxRangeDPS` молча
//     не собиралась. Правка владельца 02.10 сняла её, но слияния с апстримом будут приносить новые.
//     Порог взят не по памяти: в 3.3.5a id спеллов пятизначные (самый старший в этих файлах -- 71023),
//     а шестизначные начинаются с The Burning Crusade-дополнений выше WotLK и с 4.x; всё, что >=100000,
//     на этом клиенте не существует. Комментарии вырезаются до разбора: в них этот самый 193315 теперь
//     живёт как объяснение правки.
{
  const dataDir = require('path').dirname(SRC);
  const files = ['rangeSpells.lua', 'auraBlacklist.lua', 'customConditionalTemplates.lua',
                 'iTargetingFrames.lua'];
  const strip = (s) => s.replace(/--\[(=*)\[[\s\S]*?\]\1\]/g, ' ').replace(/--[^\n]*/g, ' ');
  const bad = [];
  let seen = 0;
  for (const f of files) {
    let text;
    try { text = strip(fs.readFileSync(require('path').join(dataDir, f), 'utf8')); }
    catch (e) { bad.push(`${f}: не читается (${e.code})`); continue; }
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      for (const m of line.matchAll(/(?:^|[^\w.])(\d{4,})(?![\w.])/g)) {
        const n = Number(m[1]);
        if (n < 1000) continue;
        seen++;
        if (n >= 100000) bad.push(`${f}:${i + 1} id ${n}`);
      }
    });
  }
  checks++;
  if (bad.length) failures++;
  console.log(`${bad.length ? 'FAIL' : 'ok  '} id спеллов в данных аддона помещаются в 3.3.5a `
    + `(проверено ${seen} чисел в ${files.length} файлах)`
    + (bad.length ? ` -- вне диапазона: ${bad.join('; ')}` : ''));
}

// (j) Пункт чёрного списка NPC в окне настроек. Механика живёт вне сниппета, поэтому проверяется
//     разбором исходника: аддон умеет прятать рамки (п. 7.32), но без строки в дереве опций игрок
//     добирается до неё только командами, а это ровно то, что владелец отверг.
{
  const optPath = path.join(path.dirname(SRC), 'options.lua');
  let opt = null, optErr = null;
  const bad = [];
  try { opt = fs.readFileSync(optPath, 'utf8'); } catch (e) { optErr = e; }
  if (opt === null) {
    bad.push(`options.lua не читается (${optErr && optErr.code})`);
  } else {
    const group = (opt.match(/^\t{4}npcBlacklist = \{[\s\S]*?\n\t{4}\},$/m) || [])[0];
    if (!group) bad.push('в дереве опций нет группы npcBlacklist (4 табуляции, как у blacklist)');
    const renderer = (opt.match(/if t\.npcBlacklist then[\s\S]*?\n\t\t\tend$/m) || [])[0];
    if (!renderer) bad.push("нет блока отрисовки 'if t.npcBlacklist then'");
    if (group) {
      if (!/npcBlacklist = true/.test(group)) bad.push('у группы нет флага npcBlacklist = true');
      if (!/name = L\.npcBlacklist/.test(group)) bad.push('у группы нет подписи L.npcBlacklist');
      if (!/type = 'input'/.test(group)) bad.push('у группы нет поля ввода');
      if (!/iTargetingFrames:NpcBlacklist\(/.test(group)) bad.push('поле ввода не зовёт NpcBlacklist');
      if (/val = tonumber\(val\)/.test(group)) bad.push('поле ввода приводит ключ к числу -- npcID рамки это строка, совпадения не будет');
      if (!/string\.match\(val, '\^%s\*\(\.\-\)%s\*\$'\)/.test(group)) bad.push('поле ввода не снимает пробелы по краям (запись перестала бы совпадать с UnitName)');
      if (!/InCombatLockdown/.test(group)) bad.push('поле ввода пишется в бою без отказа');
    }
    if (renderer) {
      if (!/pairs\(iTFConfig\.npcBlacklist\)/.test(renderer)) bad.push('блок не читает iTFConfig.npcBlacklist');
      if (!/iTF:refreshNpcBlacklist\(\)/.test(renderer)) bad.push('кнопка удаления не пересобирает сетку');
      if (!/fillContent\(keys\)/.test(renderer)) bad.push('кнопка удаления не перерисовывает список');
      if ((renderer.match(/InCombatLockdown/g) || []).length !== 1) bad.push('у удаления нет отказа в бою (или их не один)');
    }
    if (!/if not iTFConfig\.npcBlacklist then/.test(opt)) bad.push('LoadDefaults не создаёт iTFConfig.npcBlacklist');
  }
  checks++;
  if (bad.length) failures++;
  console.log(`${bad.length ? 'FAIL' : 'ok  '} пункт NPC Blacklist в окне настроек: дерево опций, отрисовка, `
    + `инициализация конфига` + (bad.length ? ` -- ${bad.join('; ')}` : ''));
}

// (k) Каждая L.<ключ>, использованная в этих двух файлах, обязана быть объявлена во всех трёх локалях:
//     файл локали объявляет ключи только под своим GetLocale(), фолбэка нет, а nil-подпись в UI
//     игрок замечает только на своём языке. Тот же смысл, что у локали в run_addon_lint.js, но
//     применительно к iTF (ее дерево там под проверкой не состоит).
{
  const locDir = path.join(path.dirname(SRC), 'Locales');
  const used = new Set();
  for (const f of [SRC, path.join(path.dirname(SRC), 'options.lua')]) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/\bL\.([A-Za-z0-9_]+)/g)) used.add(m[1]);
  }
  const bad = [];
  let declared = 0;
  for (const loc of ['enUS', 'zhCN', 'zhTW']) {
    let text;
    try { text = fs.readFileSync(path.join(locDir, loc + '.lua'), 'utf8'); }
    catch (e) { bad.push(`${loc}.lua не читается (${e.code})`); continue; }
    const keys = new Set([...text.matchAll(/^\s*L\.([A-Za-z0-9_]+)\s*=/gm)].map((m) => m[1]));
    if (loc === 'enUS') declared = keys.size;
    const missing = [...used].filter((k) => !keys.has(k)).sort();
    if (missing.length) bad.push(`${loc}.lua: не объявлено ${missing.length} (${missing.slice(0, 6).join(', ')})`);
  }
  checks++;
  if (bad.length) failures++;
  console.log(`${bad.length ? 'FAIL' : 'ok  '} локали iTF: все ${used.size} используемых ключей объявлены `
    + `(enUS объявляет ${declared})` + (bad.length ? ` -- ${bad.join('; ')}` : ''));
}

// (l) Опрос каста (iTF:refreshCast). Клиент не рассылает UNIT_SPELLCAST_* для токена nameplateN (тот же
//     класс отсутствующих событий, из-за которого в OnUpdate опрашиваются health, ауры и threat), поэтому
//     полоса каста обязана обновляться опросом, но без перерисовки каждый тик: updateCast переставляет
//     OnUpdate полосы и перетирает текст. Тело функции берётся из исходника и исполняется на заглушках,
//     а не пересказывается.
{
  const body = (src.match(/function iTF:refreshCast\(unitID\)([\s\S]*?)\nend\n/) || [])[1];
  checks++;
  if (!body) {
    failures++;
    console.log('FAIL: тело iTF:refreshCast не извлечено -- изменилась форма, гейт слепнет');
  } else {
    doString(`iTFConfig = { layout = { castBar = { enabled = true } } }\n`
      + `iTF = { frames = { nameplate3 = {} }, updateCast = function(self, unit, channel)\n`
      + `  CALLS = CALLS + 1\n  LASTCH = channel and 'channel' or 'cast'\nend }\n`
      + `function UnitCastingInfo() if CAST == nil then return nil end return CAST, 'rank', 'text', 'icon', CASTSTART end\n`
      + `function UnitChannelInfo() if CH == nil then return nil end return CH, 'rank', 'text', 'icon', CHSTART end\n`
      + `REFRESH = function(self, unitID)\n${body}\nend\n`
      + `iTF.refreshCast = REFRESH\n`);
    // [описание, каст, startTime каста, канал, startTime канала, ожидаемый вызов, ожидаемый аргумент channel]
    const CAST_CASES = [
      ['каст начался', 'Fireball', 1000, null, 0, 1, 'cast'],
      ['тот же каст, следующий тик', 'Fireball', 1000, null, 0, 0, 'cast'],
      ['тот же спелл, новый каст', 'Fireball', 1500, null, 0, 1, 'cast'],
      ['каст закончился', null, 0, null, 0, 1, 'cast'],
      ['тишины повторяем', null, 0, null, 0, 0, 'cast'],
      ['канал (UnitCastingInfo nil)', null, 0, 'Blizzard', 2000, 1, 'channel'],
      ['тот же канал', null, 0, 'Blizzard', 2000, 0, 'channel'],
    ];
    const bad = [];
    for (const [label, cast, castStart, ch, chStart, wantCalls, wantCh] of CAST_CASES) {
      doString(`CALLS = 0\nCAST = ${cast ? `'${cast}'` : 'nil'}\nCASTSTART = ${castStart}\n`
        + `CH = ${ch ? `'${ch}'` : 'nil'}\nCHSTART = ${chStart}\niTF:refreshCast('nameplate3')\nGOTCALLS = CALLS\nGOTCH = LASTCH or 'none'`);
      const got = getNumber('GOTCALLS');
      const gotCh = getString('GOTCH');
      if (got !== wantCalls) bad.push(`${label}: перерисовок ${got}, ждали ${wantCalls}`);
      else if (wantCalls && gotCh !== wantCh) bad.push(`${label}: аргумент channel=${gotCh}, ждали ${wantCh}`);
    }
    // выключенная полоса не должна стоить ни одного вызова API на рамку
    doString(`CALLS = 0\niTFConfig.layout.castBar.enabled = false\nCAST = 'Fireball'\nCASTSTART = 9000\n`
      + `iTF:refreshCast('nameplate3')\nGOTCALLS = CALLS`);
    if (getNumber('GOTCALLS') !== 0) bad.push('полоса выключена, а refreshCast всё равно зовёт updateCast');
    // и главное: опрос обязан СТОЯТЬ в основном цикле. Сама функция ничего не лечит, если её никто
    // не зовёт каждый тик -- для nameplateN событий SPELLCAST нет, и без вызова из OnUpdate полоса
    // обновляется только в момент заполнения рамки.
    const onUpdate = (src.match(/function iTF:OnUpdate\(elapsed\)([\s\S]*?)\nend\n/) || [])[1];
    if (!onUpdate) bad.push('тело iTF:OnUpdate не извлечено -- гейт слепнет');
    else {
      const call = onUpdate.indexOf('iTF:refreshCast(');
      if (call < 0) bad.push('в OnUpdate нет опроса каста');
      else if (onUpdate.lastIndexOf('if v.isShown then', call) < 0) bad.push('опрос каста вне ветки isShown');
    }
    const fill = (src.match(/function iTF:updateUnitID\(unitID\)([\s\S]*?)\nend\n/) || [])[1];
    if (!fill) bad.push('тело iTF:updateUnitID не извлечено -- гейт слепнет');
    else if (/iTF:updateCast\(unitID\)/.test(fill)) bad.push('заполнение рамки по-прежнему зовёт updateCast напрямую (каналы не читаются)');
    if (bad.length) failures++;
    console.log(`${bad.length ? 'FAIL' : 'ok  '} опрос каста по смене состояния (${CAST_CASES.length} случаев)`
      + (bad.length ? `: ${bad.join('; ')}` : ''));
  }
}

// (m) Цепочка запрета сквозняком: писатель атрибута, читатель-сниппет и дамп `/itf deny` обязаны
// сойтись ИМЕННО по имени. Три прежних сценария DENY подкладывали имя руками
// (`DENY["itfdenyitf3"]`), поэтому переименование на одной из сторон гейт пропустил бы, а в игре
// запрет молча перестал бы действовать -- ровно тот случай, о котором владелец писал 03.10
// («добавил npc в blacklist, а рамка показывает»). Здесь имя пишет сам applyDenyAttr, читает его же
// сниппет через общую таблицу атрибутов, и в конце его же печатает DebugDeny.
//
// С 03.10 20:4x этот же блок проверяет и ПЕРЕЗАПУСК раскладки: дамп в игре показал 'denied=YES memo=1
// attr=1' при висящей на месте плашке, то есть атрибут был записан, а '_itfupdate' никто не позвал --
// сниппет исполняется только на переходах состояния. Поэтому SNIP() вызывается НЕ руками теста, а через
// stub-ный mainFrame:Execute: тест подтверждает, что сам писатель будит раскладку.
//
// С 04.10 -- и САМО ИМЯ: имя с '_' в начале сниппет прочитать не может вообще (RestrictedFrames.lua:
// 188-191, молчаливый nil), а insecure-сторона такое имя пишет и читает без возражений. Поэтому дамп
// честно показывал 'attr=1' при живой плашке: записано было, прочитать было нельзя. Два прежних зелёных
// прогона этого не видели, потому что стаб GetAttribute был обычным обращением к таблице.
{
  const grab = (name) => (src.match(new RegExp('function iTF:' + name + '\\([^)]*\\)([\\s\\S]*?)\\nend\\n')) || [])[1];
  const deniedBody = grab('npcDenied'), writeBody = grab('applyDenyAttr'), dbgBody = grab('DebugDeny');
  const refreshBody = (src.match(/function iTF:refreshNpcBlacklist\(\)([\s\S]*?)\nend\n/) || [])[1];
  const nsBody = (src.match(/function iTargetingFrames:NpcBlacklist\([^)]*\)([\s\S]*?)\nend\n/) || [])[1];
  checks++;
  const wired = /iTF:DebugDeny\(\)/.test(src) && /msg == 'deny'/.test(src);
  if (!deniedBody || !writeBody || !dbgBody) {
    failures++;
    console.log('FAIL: тела npcDenied / applyDenyAttr / DebugDeny не извлечены -- гейт слепнет');
  } else if (!wired) {
    console.log("FAIL: '/itf deny' не подключён к обработчику команд");
    failures++;
  } else if (!refreshBody || !nsBody) {
    failures++;
    console.log('FAIL: тело refreshNpcBlacklist / NpcBlacklist не извлечено -- гейт не видит вторую половину цепочки');
  } else {
    doString(`
ATTR = {}
DENY = ATTR
frames = {}
iTFConfig = { npcBlacklist = {} }
EXEC = 0
iTF = {
  frames = { nameplate3 = { nameplateID = 3, unitName = 'Nerub', npcID = '21525', isShown = true },
             nameplate4 = { nameplateID = 4, unitName = 'Other', npcID = '21526', isShown = true } },
  mainFrame = { SetAttribute = function(s, name, v) ATTR[name] = v end,
                GetAttribute = function(s, name) return ATTR[name] end,
                -- как в клиенте: Execute исполняет сниппет от имени control, а тот зовёт
                -- control:RunAttribute('_itfupdate') -> ту же раскладку, что и переход состояния
                Execute = function(s, code)
                  EXEC = EXEC + 1
                  if type(code) == 'string' and code:find("_itfupdate", 1, true) then SNIP() end
                end },
  printed = {},
}
iTF.print = function(self, ...) local t = { ... } local s = '' for _, v in ipairs(t) do s = s .. tostring(v) end iTF.printed[#iTF.printed + 1] = s end
iTF.npcDenied = function(self, unitID)${deniedBody}
end
iTF.applyDenyAttr = function(self, unitID, noRerun)${writeBody}
end
iTF.DebugDeny = function(self)${dbgBody}
end
-- раскладка ДО записи: itf3 занимает клетку 2, itf4 -- клетку 3, первая клетка пуста. Порядок важен:
-- в игре рамка уже показана, а запрет приходит позже, поэтому будить раскладку обязан писателя.
iTFCurrentlyShowing = { [2] = 'itf3', [3] = 'itf4' }
iTFCurrentlyAlive = { itf3 = 2, itf4 = 3 }
self:GetFrameRef('itf3').shown = true
self:GetFrameRef('itf4').shown = true
-- писатель: blacklist-имя обязано попасть ровно в тот атрибут, который ждёт сниппет, и разбудить его
iTFConfig.npcBlacklist = { Nerub = true }
EXEC_BEFORE = EXEC
iTF:applyDenyAttr('nameplate3')
iTF:applyDenyAttr('nameplate4')
EXEC_AFTER = EXEC
WRITTEN = tostring(ATTR['itfdenyitf3'])
OTHER = tostring(ATTR['itfdenyitf4'])
-- после перезапуска запретная клетка освобождена, itf4 стянут в первую клетку (не во вторую)
SHOW1 = tostring(iTFCurrentlyShowing[1])
SHOW2 = tostring(iTFCurrentlyShowing[2])
ALIVE3 = tostring(iTFCurrentlyAlive['itf3'])
HIDDEN3 = tostring(self:GetFrameRef('itf3').shown)
-- повторный вызов при том же решении не будит раскладку второй раз
EXEC_SAME = EXEC
iTF:applyDenyAttr('nameplate3')
EXEC_STABLE = EXEC
-- снятие запрета тоже обязано разбудить раскладку: токен должен вернуться в сетку
iTFConfig.npcBlacklist = {}
iTF:applyDenyAttr('nameplate3')
EXEC_UNDENY = EXEC
CLEAR3 = tostring(ATTR['itfdenyitf3'])
-- дамп обязан показать то же значение, что записал писатель
iTFConfig.npcBlacklist = { Nerub = true }
iTF:applyDenyAttr('nameplate3')
iTF.printed = {}
iTF:DebugDeny()
LINE3 = ''
for _, s in ipairs(iTF.printed) do if s:find('nameplate3') then LINE3 = s end end
-- полный пересмотр списка: точечных перезапусков нет, пересборку делает updateMainFrameAttributes
EXEC_REFRESH = EXEC
iTF.refreshNpcBlacklist = function(self)${refreshBody}
end
iTF.updateMainFrameAttributes = function(self, newMax) UPDATE_CALLED = tostring(newMax) end
iTF:refreshNpcBlacklist()
EXEC_REFRESH_AFTER = EXEC
-- СНЯТИЕ ИЗ СПИСКА ПОЛНЫМ ПУТЁМ ИГРОКА (05.10). Прежние сценарии снимали запрет вызовом
-- applyDenyAttr напрямую, а в игре и '/itf unignore', и крестик в окне (options.lua:3437) идут через
-- iTargetingFrames:NpcBlacklist -> refreshNpcBlacklist, и тот сначала обнулял мемо. «Мемо не
-- заполнено» и «не запрещён» были одним nil, поэтому проверка «решение не изменилось» съедала ровно
-- стирающую запись: в 'itfdenyitfN' оставалась 1, сниппет держал клетку закрытой, и слот itfN умирал
-- для ВСЕХ будущих мобов до /reload. Поэтому здесь путь только через публичный NpcBlacklist.
iTargetingFrames = iTargetingFrames or {}
iTargetingFrames.NpcBlacklist = function(selfns, npc, remove)${nsBody}
end
iTFConfig.npcBlacklist = {}
iTargetingFrames:NpcBlacklist('Nerub')
PATH_ADD = tostring(ATTR['itfdenyitf3'])
iTargetingFrames:NpcBlacklist('Nerub', true)
PATH_DEL = tostring(ATTR['itfdenyitf3'])
-- и следом в этот же слот въезжает моб, которого в списке никогда не было: запрет обязан быть снят
iTF.frames.nameplate3.unitName = 'Innocent Wolf'
iTF.frames.nameplate3.npcID = '299'
iTF:applyDenyAttr('nameplate3')
PATH_NEXT = tostring(ATTR['itfdenyitf3'])
-- имя атрибута целиком: сниппет не прочитает ни одного имени с '_' в начале, и отказ там молчаливый
UNDERSCORED = ''
for k in pairs(ATTR) do if k:sub(1, 1) == '_' then UNDERSCORED = UNDERSCORED .. k .. ' ' end end
`);
    const bad = [];
    const num = (n) => Number(getNumber(n));
    if (getString('WRITTEN') !== '1') bad.push(`писатель дал ${getString('WRITTEN')} вместо itfdenyitf3`);
    const underscored = (getString('UNDERSCORED') || '').trim();
    if (underscored) bad.push(`атрибут с '_' в начале (${underscored}) -- сниппет такое имя читать не может`);
    if (getString('OTHER') !== 'nil') bad.push(`незапретный токен получил атрибут (${getString('OTHER')})`);
    if (num('EXEC_AFTER') - num('EXEC_BEFORE') !== 1) {
      bad.push(`запись запрета разбудила раскладку ${num('EXEC_AFTER') - num('EXEC_BEFORE')} раз, ожидался один перезапуск`);
    }
    if (getString('SHOW1') !== 'itf4') bad.push(`сниппет не стянул itf4 в первую клетку (там ${getString('SHOW1')})`);
    if (getString('SHOW2') !== 'nil') bad.push(`клетка 2 не освободилась (там ${getString('SHOW2')})`);
    if (getString('ALIVE3') !== '0') bad.push(`запретный токен не вернулся в очередь (alive = ${getString('ALIVE3')})`);
    if (getString('HIDDEN3') !== 'false') bad.push(`рамка запретного токена не спрятана (shown = ${getString('HIDDEN3')})`);
    if (num('EXEC_STABLE') !== num('EXEC_SAME')) bad.push('повторная запись того же решения пересобрала раскладку без смены');
    if (num('EXEC_UNDENY') <= num('EXEC_STABLE')) bad.push('снятие запрета не разбудило раскладку (токен не вернётся в сетку)');
    if (getString('CLEAR3') !== 'nil') bad.push(`после снятия запрета атрибут остался ${getString('CLEAR3')}`);
    if (num('EXEC_REFRESH_AFTER') !== num('EXEC_REFRESH')) bad.push('refreshNpcBlacklist будит раскладку точечно, хотя пересобирает её целиком');
    if (getString('UPDATE_CALLED') !== 'true') bad.push('refreshNpcBlacklist не вызывает updateMainFrameAttributes(true)');
    if (getString('PATH_ADD') !== '1') bad.push(`публичный NpcBlacklist не поставил запрет (attr = ${getString('PATH_ADD')})`);
    if (getString('PATH_DEL') !== 'nil') {
      bad.push(`снятие через NpcBlacklist/refresh не стёрло атрибут (остался ${getString('PATH_DEL')}) -- слот запрещён навсегда`);
    }
    if (getString('PATH_NEXT') !== 'nil') {
      bad.push(`следующий моб в том же слоте унаследовал запрет (attr = ${getString('PATH_NEXT')})`);
    }
    const line3 = getString('LINE3') || '';
    if (!/attr=1/.test(line3) || !/denied=YES/.test(line3)) bad.push('дамп /itf deny не видит то же значение: ' + JSON.stringify(line3));
    if (bad.length) failures++;
    console.log(`${bad.length ? 'FAIL' : 'ok  '} цепочка запрета сходится по имени и будит раскладку (писатель → сниппет → дамп)`
      + (bad.length ? `: ${bad.join('; ')}` : ''));
  }
}

// (n) Имя зеркала слотов обязано сойтись на двух сторонах границы. Пишет его secure-сниппет
// ('itfslot'..токен), читает insecure-код в frameSlot -- и это ровно тот класс дефекта, который уже
// дважды стоил прогона в игре: DENY-атрибут с '_' (сниппет такое имя читать не может) и переименование
// на одной из сторон. Проверка сравнивает ЛИТЕРАЛЫ обеих сторон, а не подкладывает имя руками.
{
  const bad = [];
  const write = (snippet.match(/self:SetAttribute\('(\w+)'\.\.k/) || [])[1];
  const slotFn = (src.match(/function frameSlot\(frame\)([\B\s\S]*?)\nend\n/) || [])[1];
  const readName = slotFn && (slotFn.match(/GetAttribute\('(\w+)'\s*\.\.\s*frame\.nameplateID\)/) || [])[1];
  // имя обязано сойтись ЦЕЛИКОМ, а не префиксом: писатель клеит 'itfslot'..токен, а токен -- 'itf3'.
  // Прежняя редакция этой проверки сравнивала префиксы и пропустила ровно эту ошибку.
  if (!write) bad.push("в сниппете нет записи зеркала вида self:SetAttribute('имя'..k");
  if (!slotFn) bad.push('frameSlot не извлечён -- гейт слепнет');
  if (!readName) bad.push('frameSlot не читает зеркало атрибутом по nameplateID');
  if (write && readName && write + 'itf' !== readName) {
    bad.push(`имена расходятся: писатель 'itfslot'..токен даёт '${write}itf3', читатель ждёт '${readName}3'`);
  }
  if (readName && readName.charAt(0) === '_') bad.push(`читатель ждёт имя с '_' (${readName}) -- HANDLE:GetAttribute отдаёт nil`);
  checks++;
  if (bad.length) failures++;
  console.log(`${bad.length ? 'FAIL' : 'ok  '} зеркало слотов сходится по имени на обеих сторонах границы`
    + (bad.length ? `: ${bad.join('; ')}` : ''));
}

// (o) Состояние индикаторов обязано существовать у рамки С МОМЕНТА СОЗДАНИЯ (п. 7.52: вылет
// `attempt to index field 'waitingFor' (a nil value)` на nameplate1, замер 04.10 02:11). Имена ключей,
// которые пишут индикаторы, сверяются с фабрикой состояний, а не подкладываются тестом: расхождение имени
// и есть тот nil, на котором падал клиент.
{
  const cut = (marker) => {
    const at = src.indexOf(marker);
    if (at < 0) return '';
    const stop = src.indexOf('\nend\n', at);
    return stop < 0 ? '' : src.slice(at, stop);
  };
  const factory = cut('local function newIndicatorState()');
  const keys = [];
  for (const m of factory.matchAll(/\['(\w+)'\] = \{\}/g)) keys.push(m[1]);
  checks++;
  if (keys.length < 7) {
    failures++;
    console.log(`FAIL фабрика newIndicatorState объявляет ключей ${keys.length} (${keys.join(', ')}) -- срез не тот`);
  } else {
    console.log(`ok   фабрика состояния индикаторов объявляет ${keys.length} ключей (${keys.join(', ')})`);
  }

  // CreateNew обязан ставить состояние ДО любого раннего выхода: рамки создаются на все maxUnits слотов,
  // а первое обращение к waitingFor приходит из события, у которого юнита ещё нет
  const createNew = cut('function iTF:CreateNew(unitID, i)');
  const assign = createNew.indexOf('waitingFor = newIndicatorState()');
  const firstReturn = createNew.indexOf('return');
  checks++;
  if (assign < 0) { failures++; console.log('FAIL CreateNew не инициализирует waitingFor -- путь п. 7.52 вернулся'); }
  else if (firstReturn >= 0 && firstReturn < assign) { failures++; console.log('FAIL CreateNew выходит раньше, чем ставит waitingFor'); }
  else console.log('ok   индикаторы живы с момента создания рамки (CreateNew ставит состояние до выхода)');

  for (const fn of ['border', 'opacity', 'statusbar']) {
    const body = cut(`function indicatorFuncs:${fn}(`);
    const used = [...new Set((body.match(/waitingFor\.(\w+)/g) || []).map((t) => t.replace('waitingFor.', '')))];
    checks++;
    const missing = used.filter((k) => !keys.includes(k));
    if (!used.length) { failures++; console.log(`FAIL писатель ${fn} не трогает waitingFor -- проверка больше не про него`); }
    else if (missing.length) { failures++; console.log(`FAIL писатель ${fn} пишет waitingFor.${missing.join('/')}, а фабрика такого ключа не объявляет`); }
    else console.log(`ok   писатель ${fn} -> waitingFor.${used.join(', ')} (все объявлены фабрикой)`);
  }
  // список имён индикаторов, которые игрок вообще может выбрать, живёт в options.lua (getIndicatorTypes);
  // каждое из них обязано быть объявлено фабрикой состояний -- glows получает ключ ПЕРВЫМ аргументом из
  // `for k in pairs(...indicators)`, и необъявленный ключ это ровно тот же вылет, что п. 7.52
  const optSrc = fs.readFileSync(path.join(path.dirname(SRC), 'options.lua'), 'utf8');
  const picker = (optSrc.match(/return \{\['glowLeft'.*/) || [])[0];
  const wanted = [...new Set([...(picker || '').matchAll(/\['(\w+)'\] =/g)].map((m) => m[1]))];
  checks++;
  const missing = wanted.filter((k) => !keys.includes(k));
  if (!picker) { failures++; console.log('FAIL список индикаторов в options.lua не найден -- проверка слепая'); }
  else if (missing.length) { failures++; console.log(`FAIL игрок может выбрать ${missing.join('/')}, а фабрика состояния такого ключа не объявляет`); }
  else console.log(`ok   все ${wanted.length} имён индикаторов из окна настроек объявлены фабрикой состояния`);
  }

// 8) порядок операций в окне настроек (п. 7.64): три места, где правильный результат зависит не от того,
//    ЧТО написано, а от того, в каком порядке. Такое не ловится ни синтаксисом, ни «мёртвый локал» --
//    код компилируется, молчит и даёт неверный ответ только на одном из двух путей.
{
  const optSrc = fs.readFileSync(path.join(path.dirname(SRC), 'options.lua'), 'utf8');

  // 8a) iTF:LoadDefaults -- сброс СТАРОГО конфига обязан идти до блоков `if not iTFConfig.X then`, иначе
  //     он сносит только что созданные подтаблицы, и `pairs(iTFConfig.blacklist)` ниже падает на nil.
  //     Отказ в бою обязан идти ещё раньше сброса, иначе reset в бою успевает стереть конфиг и выйти.
  const ld = optSrc.slice(optSrc.indexOf('function iTF:LoadDefaults(force)'));
  const body = ld.slice(0, ld.indexOf('\nfunction ') < 0 ? ld.length : ld.indexOf('\nfunction '));
  const iWipe = body.indexOf('if iTFConfig.frame then');
  const iCombat = body.indexOf('if InCombatLockdown() then');
  const subTables = ['bindings', 'custom', 'blacklist', 'priorityNPCs', 'npcBlacklist']
    .map((k) => ({ k, at: body.indexOf(`if not iTFConfig.${k} then`) }));
  const iReadBlacklist = body.indexOf('pairs(iTFConfig.blacklist)');

  checks++;
  if (iWipe < 0 || iCombat < 0 || subTables.some((s) => s.at < 0) || iReadBlacklist < 0) {
    failures++;
    console.log('FAIL LoadDefaults разобрать не удалось -- проверка п. 7.64 ослепла, а не прошла');
  } else {
    const late = subTables.filter((s) => s.at < iWipe);
    if (late.length) {
      failures++;
      console.log(`FAIL LoadDefaults: сброс старого конфига ниже создания подтаблиц ${late.map((s) => s.k).join('/')}`
        + ' -- reset сносит их, и pairs(iTFConfig.blacklist) ниже падает на nil');
    } else if (iCombat > iWipe) {
      failures++;
      console.log('FAIL LoadDefaults: отказ в бою стоит ПОСЛЕ сброса -- reset в бою стирает конфиг и выходит');
    } else {
      console.log('ok   LoadDefaults: отказ в бою -> сброс старого конфига -> создание подтаблиц (/itf reset доживает до конца)');
    }
  }

  // 8b) обработчики колеса у скроллбаров: пределы слайдера обязаны быть взяты ДО ветвления по delta.
  //     Если `local min, max = ...:GetMinMaxValues()` стоит внутри ветки «вниз», то ветка «вверх»
  //     зажимает значение по ГЛОБАЛЬНОМУ max (в 3.3.5a это math.max) -- то есть по константе 0 из
  //     второго аргумента, а не по минимуму слайдера. Работает только пока минимум равен нулю.
  // считаем по КОДУ: строки-комментарии выбрасываем, иначе объяснение правки рядом с ней же ломает счёт
  const optCode = optSrc.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
  const wheelsTotal = (optCode.match(/GetMinMaxValues\(\)/g) || []).length;
  // пределы взяты до ветвления: GetMinMaxValues() и сразу следующей строкой `if delta ==`
  const hoisted = (optCode.match(/GetMinMaxValues\(\)\s*\n\s*if delta ==/g) || []).length;
  // пределы взяты внутри ветки: `if delta ==` и сразу следующей строкой local min, max = ...GetMinMaxValues
  const inBranch = (optCode.match(/if delta ==[^\n]*\n\s*local\s+min\s*,\s*max\s*=[^\n]*GetMinMaxValues/g) || []).length;
  checks++;
  if (wheelsTotal !== 3) {
    failures++;
    console.log(`FAIL обращений к GetMinMaxValues() найдено ${wheelsTotal}, а не 3 -- проверка больше не про обработчики колеса`);
  } else if (inBranch) {
    failures++;
    console.log(`FAIL ${inBranch} из 3 обработчиков колеса берут GetMinMaxValues() внутри ветки по delta`
      + ' -- противоположная ветка зажимает по глобальному min/max, а не по пределам слайдера');
  } else if (hoisted !== 3) {
    failures++;
    console.log(`FAIL пределы слайдера взяты до ветвления только в ${hoisted} из 3 обработчиков`
      + ' -- остальные разобрать не удалось, проверка ослепла');
  } else {
    console.log('ok   все 3 обработчика колеса берут пределы слайдера до ветвления по delta');
  }

  // 8c) компиляция пользовательской условки: второе значение getFunction -- текст ошибки loadstring, и он
  //     обязан попадать в сообщение игроку. Плюс имя этого локала не должно быть `error`: так оно
  //     перекрывает глобальный error() на весь остаток области видимости.
  const code = src.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
  const callAt = code.indexOf('getFunction(v.func)');
  checks++;
  if (callAt < 0) {
    failures++;
    console.log('FAIL место компиляции пользовательской условки не найдено -- проверка п. 7.64 ослепла');
  } else {
    const site = code.slice(Math.max(0, callAt - 200), callAt + 600);
    const errName = (site.match(/local\s+\w+\s*,\s*(\w+)\s*=\s*getFunction/) || [])[1];
    // сообщение -- ровно тот iTF:print, который говорит про Custom conditional, и ничего после него
    const msgStart = site.indexOf("iTF:print('Error, something is wrong with Custom conditional");
    const msg = msgStart < 0 ? '' : site.slice(msgStart, site.indexOf('\n', site.indexOf('))', msgStart)) + 1 || undefined);
    if (errName === 'error') {
      failures++;
      console.log("FAIL текст ошибки loadstring пойман в локал с именем `error` -- он перекрывает глобальный error()");
    } else if (!errName) {
      failures++;
      console.log('FAIL getFunction вызывается без приёма второго значения -- причина ошибки условки теряется');
    } else if (msgStart < 0) {
      failures++;
      console.log('FAIL сообщение про Custom conditional не найдено -- проверка ослепла');
    } else if (!new RegExp(`\\b${errName}\\b`).test(msg)) {
      failures++;
      console.log(`FAIL причина ошибки (${errName}) не попадает в сообщение про Custom conditional`
        + ' -- игрок видит «something is wrong» без текста loadstring');
    } else {
      console.log(`ok   текст ошибки loadstring (${errName}) доходит до сообщения про Custom conditional`);
    }
  }
}

console.log(failures ? `Проверки iTF: ПРОВАЛ (${failures})` : 'Проверки iTF: зелёный — ' + checks + ' проверок');
process.exit(failures ? 1 : 0);
