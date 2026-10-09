// Гейт аддонов и текста: синтаксис Lua 5.1, полнота локалей AwesomeCVar, кодировка локалей (UTF-8 без
// BOM) и hygiene prose -- в нашем тексте (README, plan, драйверы гейтов, наши аддоны) не должно быть
// иероглифов; вендорские деревья (iTargetingFrames и его libs) проверяются только на синтаксис.
//
//   node tools/run_addon_lint.js
//
// Синтаксис проверяется luaparse из MRT/tools/luacheck (того же, что стоит в CI-подобных проверках
// проекта); локалевая проверка важна потому, что каждый Locales/*.lua объявляет ключи только под своим
// GetLocale(), то есть фолбэка нет: L.CVAR_LABEL_X, отсутствующий в ruRU, даёт nil-подпись в UI.

const fs = require('fs');
const path = require('path');

// luaparse живёт вне репозитория. Порядок поиска: AW_LUAPARSE -> рядом стоящий проект MRT (машина
// разработчика) -> локальный node_modules. На чужой машине: npm i luaparse fengari в tools/ и готово.
const LUAPARSE_CANDIDATES = [
  process.env.AW_LUAPARSE,
  'C:/Games/backport/MRT-3.3.5a/tools/luacheck/node_modules/luaparse',
  path.join(__dirname, 'node_modules/luaparse'),
].filter(Boolean);
let luaparse = null;
for (const candidate of LUAPARSE_CANDIDATES) {
  try { luaparse = require(candidate); break; } catch (e) { /* следующий кандидат */ }
}
if (!luaparse) {
  console.log('FAIL: luaparse не найден. Поставь AW_LUAPARSE=<путь к luaparse> или npm i luaparse в tools/.');
  process.exit(1);
}

const root = path.join(__dirname, '..');
const addonsDir = path.join(root, 'addons');

function listLua(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listLua(full));
    else if (entry.name.toLowerCase().endsWith('.lua')) out.push(full);
  }
  return out;
}

// listLua фильтрует по расширению -- для js-файлов нужен отдельный обход, иначе текстовая проверка
// молча ничего не проверяет (собственный баг этого гейта, найден 01.10).
function listFiles(dir, exts) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, exts));
    else if (exts.some((e) => entry.name.toLowerCase().endsWith(e))) out.push(full);
  }
  return out;
}

let failures = 0;

// --- 1. синтаксис ------------------------------------------------------------
const files = [];
for (const addon of fs.readdirSync(addonsDir)) {
  const dir = path.join(addonsDir, addon);
  if (fs.statSync(dir).isDirectory()) files.push(...listLua(dir));
}
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  try {
    luaparse.parse(src, { luaVersion: '5.1' });
  } catch (e) {
    failures++;
    console.log('FAIL синтаксис ' + path.relative(root, file) + ': ' + e.message);
  }
}
console.log('синтаксис Lua 5.1: ' + files.length + ' файл(ов), ошибок ' + failures);

// --- 1b. сниппеты безопасного окружения ---------------------------------------
// Текст, который уезжает в SetAttribute('_itfupdate', ...), -- строка: разбор файла её не проверяет,
// а опечатка внутри ломает сетку плейтов уже в игре. Достаём тело, подставляем вместо %d/%s реальные
// значения и парсим как Lua 5.1. Если форма вызова поменяется -- гейт падает, а не молчит.
{
  const itf = path.join(addonsDir, 'iTargetingFrames', 'iTargetingFrames.lua');
  const src = fs.readFileSync(itf, 'utf8');
  const snippet = (src.match(/SetAttribute\('_itfupdate', string\.format\(\[\[([\s\S]*?)\]\], iTFConfig/) || [])[1];
  if (!snippet) {
    failures++;
    console.log("FAIL: сниппет '_itfupdate' не извлечён -- изменилась форма вызова, гейт слепнет");
  } else {
    const body = snippet.replace(/%d/g, '60').replace(/'%s'/g, "'BOTTOMRIGHT'");
    try {
      luaparse.parse(body, { luaVersion: '5.1' });
      console.log("сниппет '_itfupdate': " + body.split('\n').length + ' строк читается как Lua 5.1');
    } catch (e) {
      failures++;
      console.log("FAIL сниппет '_itfupdate': " + e.message);
    }
  }
}

// --- 1c. раскладка iTF: полная замена layout обязана пересобирать secure-сетку --
// Сетка живёт не только в iTFConfig: сниппет '_itfupdate' собран под конкретный maxUnits (циклы
// `for i = 1, %d`), а iTFUnitPositions в secure-среде посчитаны по текущему макету. Присваивание
// `iTFConfig.layout = ...` без пересборки оставляет игру с прежним сниппетом: замер 02.10 -- `/itf reset`
// с maxUnits=6 оставлял плейты 7..25 вечно ждать в очереди («моб есть, рамки нет»), то есть ровно те
// дырки, из-за которых стяжку и делали. Обратное свойство: обработчик не имеет права пересобирать сетку
// дважды -- ветки 'size' и 'pos' сами заканчиваются updateMainFrameAttributes(true)
// (iTargetingFrames.lua:1601 и :1654), а каждая такая пересборка прячет все 60 рамок и раздаёт слоты
// заново в порядке pairs(), то есть перетасовывает показанные рамки по клеткам. Третье свойство того же
// пути: `/itf reset` -- единственный конфиг, который игрок может вызвать, стоя в бою (окно настроек сам
// аддон закрывает на PLAYER_REGEN_DISABLED, iTargetingFrames.lua:2305-2307), поэтому в LoadDefaults отказ
// по InCombatLockdown обязан стоять ДО первой записи конфига: дефолтный layout при прежнем сниппете -- это
// ровно та дырка, что лечится пересборкой, и в бою её нечем закрыть до конца боя.
{
  // AW_ITF_DIR -- каталог с копиями двух файлов (iTargetingFrames.lua, options.lua), чтобы снимать
  // негативный прогон, не трогая развёрнутый аддон (тот же приём, что AW_ITF_SRC в run_itf_layout_check.js)
  const itfDir = process.env.AW_ITF_DIR || path.join(addonsDir, 'iTargetingFrames');
  const REBUILD = /iTF:updateFrames\(\s*\)|iTF:updateFrames\('(size|pos)'\)/;
  const DOUBLE = /iTF:updateFrames\('(size|pos)'\)/;
  let swaps = 0, holes = 0, doubles = 0, locks = 0;
  for (const f of ['iTargetingFrames.lua', 'options.lua']) {
    const p = path.join(itfDir, f);
    const clean = fs.readFileSync(p, 'utf8')
      .replace(/--\[(=*)\[[\s\S]*?\]\1\]/g, '').replace(/--[^\n]*/g, '').split('\n');
    clean.forEach((line, i) => {
      // `= {}` -- не замена, а создание пустой таблицы под последующий merge (первый запуск, аддон ещё
      // не создал ни одной рамки), пересобиравать там нечего и нечем
      const swap = line.match(/^\s*iTFConfig\.layout\s*=\s*(\S[^\n]*)/);
      if (swap && swap[1][0] !== '{') {
        swaps++;
        if (!REBUILD.test(clean.slice(i, i + 25).join('\n'))) {
          holes++;
          console.log(`FAIL ${f}:${i + 1} layout заменён целиком, но сетка не пересобирается ` +
            `-- в 25 строках нет ни updateFrames(), ни updateFrames('size'/'pos')`);
        }
      }
      if (/iTF:updateMainFrameAttributes\(true\)/.test(line)
          && DOUBLE.test(clean.slice(Math.max(0, i - 6), i + 7).join('\n'))) {
        doubles++;
        console.log(`FAIL ${f}:${i + 1} двойная пересборка сетки в одном обработчике -- ` +
          `updateFrames('size'/'pos') уже заканчивается updateMainFrameAttributes(true)`);
      }
    });
  }
  if (!swaps) {
    failures++;
    console.log('FAIL iTF: не найдено ни одного `iTFConfig.layout =` -- гейт слепнет');
  } else if (holes || doubles) {
    failures += holes + doubles;
  } else {
    console.log(`iTF: пересборка сетки -- ${swaps} мест(о) замены layout, двойных пересборок нет`);
  }

  // Отказ в бою до записи конфига -- по строкам функции iTF:LoadDefaults, а не по всему файлу:
  // замена layout в загрузке профиля (options.lua:2276) от боя защищена тем, что окно настроек
  // закрыто, и требовать здесь локальной проверки значило бы выдумывать её.
  {
    const p = path.join(itfDir, 'options.lua');
    const strip = (s) => s.replace(/--\[(=*)\[[\s\S]*?\]\1\]/g, '').replace(/--[^\n]*/g, '').split('\n');
    const clean = strip(fs.readFileSync(p, 'utf8'));
    const start = clean.findIndex((l) => /^function iTF:LoadDefaults\b/.test(l));
    let end = clean.length;
    for (let i = Math.max(0, start) + 1; i < clean.length; i++) {
      if (/^(local )?function /.test(clean[i])) { end = i; break; }
    }
    const at = (re) => clean.findIndex((l, i) => i > start && i < end && re.test(l));
    const swap = at(/^\s*iTFConfig\.layout\s*=\s*[^{\s]/);
    const guard = at(/InCombatLockdown\(\)/);
    const refuses = guard >= 0 && /(^|\s)return(\s|$|;)/.test(clean.slice(guard, guard + 5).join('\n'));
    if (start < 0) {
      locks++;
      console.log('FAIL options.lua: не найден iTF:LoadDefaults -- гейт слепнет');
    } else if (swap < 0) {
      locks++;
      console.log(`FAIL options.lua:${start + 1} в LoadDefaults нет замены layout -- проверять отказ больше не где`);
    } else if (guard < 0 || guard > swap || !refuses) {
      locks++;
      console.log(`FAIL options.lua:${swap + 1} конфиг меняется раньше отказа по InCombatLockdown ` +
        `-- в бою reset оставляет дефолтный layout на СТАРОМ сниппете, и до конца боя дырка не смывается`);
    } else {
      console.log(`LoadDefaults: отказ в бою стоит до записи конфига (:${guard + 1} перед :${swap + 1})`);
    }
  }
  if (locks) failures += locks;
}

// --- 1d. загрузчики: каждая <Script>/<Include> в xml и каждая строка .toc обязана указывать на файл
// Класс дефекта, который появляется ровно при вырезании файлов аддона (03.10: из ElvUI_ProjectZidras
// удалён модуль UnitFrames вместе с библиотеками): синтаксис Lua его не видит, а клиент на строке
// `<Script file="Удалённый.lua"/>` даёт ошибку загрузки аддона целиком. Тот же контроль для .toc, где
// перечислены файлы верхнего уровня.
{
  let loaderFiles = 0, refs = 0, broken = 0;
  const checkRefs = (file, list) => {
    loaderFiles++;
    const dir = path.dirname(file);
    for (const rel of list) {
      refs++;
      const target = path.join(dir, rel.replace(/\\/g, path.sep));
      if (!fs.existsSync(target)) {
        broken++;
        failures++;
        console.log('FAIL ' + path.relative(root, file) + ': ссылка на отсутствующий файл -> ' + rel);
      }
    }
  };
  for (const file of listFiles(addonsDir, ['.xml'])) {
    checkRefs(file, [...fs.readFileSync(file, 'utf8').matchAll(/<(?:Script|Include)\s+file=["']([^"']+)["']/g)].map((m) => m[1]));
  }
  for (const file of listFiles(addonsDir, ['.toc'])) {
    checkRefs(file, [...fs.readFileSync(file, 'utf8').matchAll(/^(?!#)\s*(\S+\.(?:lua|xml))\s*$/gim)].map((m) => m[1]));
  }
  console.log('загрузчики: ' + loaderFiles + ' файла(ов), ссылок ' + refs + ', битых ' + broken);
}

// --- 2. локали AwesomeCVar ----------------------------------------------------
const cvarDir = path.join(addonsDir, 'AwesomeCVar');
const used = new Set();
for (const file of ['Constants.lua', 'UI.lua', 'Core.lua']) {
  const src = fs.readFileSync(path.join(cvarDir, file), 'utf8');
  for (const m of src.matchAll(/\bL\.([A-Z][A-Z0-9_]*)\b/g)) used.add(m[1]);
}
// Каждый Locales/*.lua объявляет ключи только под своим GetLocale(), фолбэка нет. Проверять два
// «главных» языка бессмысленно: в 02.10 именно так и прошли мимо семи локалей, в которых не было пяти
// ключей (DESC_CAMERA_FOV, DESC_NAMEPLATE_DISTANCE, DESC_INTERACTION_MODE, DESC_INTERACTION_ANGLE,
// AW_OFF) -- немецкий/корейский/китайский игрок видел пустые описания вместо подписей.
for (const file of listLua(path.join(cvarDir, 'Locales'))) {
  const locale = path.basename(file, '.lua');
  const src = fs.readFileSync(file, 'utf8');
  const declared = new Set([...src.matchAll(/^\s*L\.([A-Z][A-Z0-9_]*)\s*=/gm)].map(m => m[1]));
  const missing = [...used].filter(k => !declared.has(k)).sort();
  if (missing.length) {
    failures += missing.length;
    console.log('FAIL ' + locale + '.lua не объявляет ' + missing.length + ' используемых ключ(ей): ' + missing.join(', '));
  } else {
    console.log('локаль ' + locale + ': все ' + used.size + ' используемых ключей объявлены');
  }
}

// --- 3. кодировка локалей -----------------------------------------------------
// Клиент 3.3.5a ждёт UTF-8 без BOM; BOM в начале Lua-файла ломает разбор всего чанка.
for (const file of listLua(path.join(cvarDir, 'Locales'))) {
  const buf = fs.readFileSync(file);
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    failures++;
    console.log('FAIL ' + path.relative(root, file) + ': BOM в начале файла');
  }
  try { buf.toString('utf8'); } catch (e) {
    failures++;
    console.log('FAIL ' + path.relative(root, file) + ': не UTF-8');
  }
}

// --- 4. текст: в русской прозе и комментариях не должно быть иероглифов ---------
// Реальный дефект этих сессий: между русскими словами появлялись CJK-символы («не加载», «整个ого»,
// «这是我们»). Клиент такое не накажет, человек в тексте не заметит, а смысл строки меняется. Ловим
// механизмом: zhCN/zhTW -- единственные места, где иероглифы законны.
const zh = /[\\\/]Locales[\\\/]?(zhCN|zhTW)\.lua$/i;
// Проверяем только НАШ текст: README, plan, драйверы гейтов и аддоны, которые написаны здесь.
// Чужое дерево (iTargetingFrames с его libs) не под проверкой: LibSharedMedia законно держит имена
// шрифтов иероглифами, и править их -- портить вендорский код.
const ownAddons = ['AWNamePlateAPI', 'AwesomeCVar', 'Flash'];
const ownFiles = ownAddons.flatMap((addon) => {
  const dir = path.join(addonsDir, addon);
  return fs.existsSync(dir) ? listLua(dir).filter((f) => !zh.test(f)) : [];
});
const textTargets = [path.join(root, 'README.md'), path.join(root, 'plan.md')].filter((f) => fs.existsSync(f))
  // docs/ есть только в рабочем каталоге: в публичном клоне исходников внутренней документации нет,
  // и отсутствие каталога -- не проход проверки «наискосок», а другое дерево.
  .concat(fs.existsSync(path.join(root, 'docs')) ? listFiles(path.join(root, 'docs'), ['.md']) : [])
  .concat(listFiles(path.join(__dirname), ['.js']).filter((f) => !f.endsWith('run_addon_lint.js')))
  .concat(ownFiles);
const CJK = /[\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff66-\uff9f]/;
// Управляющие символы в тексте -- вторая половина той же болезни: путь журнала писался в docs как
// `Logs\aw_probe.log`, а `\a` в строке Node/JS есть BEL (0x07), и в файл уехал невидимый звонок вместо
// двух букв. На экране не видно, GitHub-рендерер проглатывает, а человек ищет `aw_probe.log` и не находит.
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
let cjkHits = 0;
let ctrlHits = 0;
for (const file of textTargets) {
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (CJK.test(line)) {
      cjkHits++;
      console.log('FAIL ' + path.relative(root, file) + ':' + (i + 1) + ': иероглифы в тексте: ' + line.trim().slice(0, 90));
    }
    const m = line.match(CTRL);
    if (m) {
      ctrlHits++;
      console.log('FAIL ' + path.relative(root, file) + ':' + (i + 1) + ': управляющий символ 0x' +
        m[0].charCodeAt(0).toString(16) + ' в тексте: ' + line.trim().slice(0, 90));
    }
  });
}
// --- 5. якоря README: каждая ссылка вида href="#x" обязана иметь <a name="x"> --------------
// Витрина двоязычная и с оглавлением; битый якорь в GitHub-рендерере не виден, поэтому проверяем машиной.
{
  const readme = path.join(root, 'README.md');
  if (fs.existsSync(readme)) {
    const doc = fs.readFileSync(readme, 'utf8');
    const named = new Set([...doc.matchAll(/<a name="([^"]+)"><\/a>|<a name="([^"]+)">/g)].map((m) => m[1] || m[2]));
    const bad = [...doc.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]).filter((id) => !named.has(id));
    if (bad.length) {
      failures += bad.length;
      console.log('FAIL README.md: битые якоря -> ' + [...new Set(bad)].join(', '));
    } else {
      console.log('README.md: ' + named.size + ' якорей, все ссылки оглавления разрешаются');
    }
  }
}

console.log(cjkHits ? 'текст: ' + cjkHits + ' строк с иероглифами' : 'текст: ' + textTargets.length + ' файлов проверено, иероглифов нет');
console.log(ctrlHits ? 'текст: ' + ctrlHits + ' строк с управляющими символами' : 'текст: управляющих символов нет');
failures += cjkHits + ctrlHits;

// --- 6. слайдеры AwesomeCVar: каждый программный SetValue обязан быть обложен флагом ----------------
// OnValueChanged у нашей строки пишет CVar, а WoW вызывает этот же обработчик и на программный SetValue
// (в Blizzard-панели поэтому и переподписывают SetValue). Без флага само открытие окна или смена вкладки
// (UpdateAllUI) переписывали каждую переменную слайдера, зажимали до min/max значение, поставленное
// игроком в консоли, а OnMouseUp после клика без перетаскивания печатал в чат «изменение», которого не
// было. Инвариант машинный: у каждого SetValue слайдера флаг стоит до вызова и снят после.
{
  const file = path.join(addonsDir, 'AwesomeCVar', 'UI.lua');
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const bare = [];
  let sites = 0;
  lines.forEach((line, i) => {
    if (!/(?:^|[^a-zA-Z_])slider:SetValue\(/.test(line)) return;
    sites++;
    const before = lines.slice(Math.max(0, i - 3), i).join('\n');
    const after = lines.slice(i + 1, i + 4).join('\n');
    if (!/awProgrammatic\s*=\s*true/.test(before) || !/awProgrammatic\s*=\s*nil/.test(after)) {
      bare.push((i + 1) + ': ' + line.trim());
    }
  });
  if (!sites) {
    failures++;
    console.log('FAIL UI.lua: не найден ни один программный SetValue слайдера -- проверка разъехалась с кодом');
  } else if (bare.length) {
    failures += bare.length;
    console.log('FAIL UI.lua: SetValue слайдера без awProgrammatic -> ' + bare.join(' | '));
  } else {
    console.log('UI.lua: программных SetValue слайдера ' + sites + ', все обложены awProgrammatic');
  }
}

console.log(failures ? 'Луа-гейт: ПРОВАЛ (' + failures + ')' : 'Луа-гейт: зелёный');
process.exit(failures ? 1 : 0);
