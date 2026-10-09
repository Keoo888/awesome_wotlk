// Запускает AwesomeWotlkLib.dll вне игры и проверяет, что путь загрузки проходит, а профиль в баннере
// ровно тот, что зашит.
//
// Сборка beforehand:  cmake -S . -B reference/build -G "Visual Studio 18 2026" -A Win32 -T host=x64 -DAW_BUILD_TESTS=ON
//                      cmake --build reference/build --config Release
// Затем:               node tools/run_dll_smoke.js
//
// Внешние настройки убраны из сборки 01.10 (aw_plate.conf больше не читается), поэтому этот гейт проверяет
// не парсер, а сам зашитый профиль: `source=compiled-in profile` и все 14 ключей в баннере.
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const rel = path.join(root, "reference", "build", "Release");
const host = path.join(rel, "dll_smoke.exe");
const dll = path.join(rel, "AwesomeWotlkLib.dll");
if (!fs.existsSync(host) || !fs.existsSync(dll)) {
  console.error("нет dll_smoke.exe/AwesomeWotlkLib.dll в reference/build/Release — соберите с -DAW_BUILD_TESTS=ON");
  process.exit(2);
}

// Конф из каталога стенда удаляем: если dll снова начнёт читать настройки рядом с exe, проверка это поймает
// по другому source= в баннере.
fs.rmSync(path.join(rel, "aw_plate.conf"), { force: true });
const logPath = path.join(rel, "Logs", "aw_probe.log");
fs.rmSync(logPath, { force: true });

let hostOut = "", code = 0;
try {
  hostOut = execFileSync(host, [dll], { encoding: "latin1", cwd: rel, timeout: 45000, killSignal: "SIGKILL" });
} catch (e) {
  code = e.status === undefined ? -1 : e.status;
  if (e.killed) console.log("!!! хост снят по таймауту 45 с — вероятен повторный trap по тому же адресу");
  hostOut = (e.stdout || "") + (e.stderr || "");
}

const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, "latin1") : "";
console.log(hostOut.trim() ? "--- stdout хоста ---\n" + hostOut.trim() : "");
console.log("--- Logs\\aw_probe.log ---\n" + (log.trim() || "<пустой>"));

const stubsAll = /STUBS_ALL_OK/.test(hostOut);
// Замер 01.10: на ОДНОЙ и той же dll пять прогонов дали commit = 87, 87, 87, 87, 0, а один из семи дал
// `boot: detour transaction faulted (C0000005)`. Причина не в dll: стенд резервирует площадки клиента
// через VirtualAlloc, и какие из них заняты раскладкой его собственной кучи, решает ASLR запуска.
// Поэтому commit здесь справочный, а проверка одна: dll должна дойти до `boot: done` и не уронить процесс.
const commitLine = (log.match(/boot: commit = ([-\d]+)/) || [])[1];
const faulted = /boot: detour transaction faulted/.test(log);
const extras = (log.match(/boot: extras commit = ([-\d]+)/) || [])[1];
console.log("замер стенда: boot: commit = " + (commitLine === undefined ? "<нет строки>" : commitLine) +
  ", extras = " + (extras === undefined ? "<нет строки>" : extras) +
  ", стабы: " + (stubsAll ? "все площадки свободны" : "часть занята кучей хоста (норма)"));

// Профиль зашит в Settings.h. Любая правка там обязана быть отражена здесь -- иначе гейт молча пропустит,
// что сборка перестала быть проверенной.
const PROFILE = { scope: 4, sort: 0, token: 1, drhook: 0, tokensite: 0, gate: 0, ptrpatch: 0, log: 1, camera: 1, macros: 1, clipboard: 1, namegate: 0, fade: 1, interact: 1, distance: 1 };
const banner = log.split(/\r?\n/).find((l) => l.indexOf("=== awesome_wotlk nameplate build") >= 0) || "";

const checks = [
  ["хост не упал (код " + code + ")", code === 0],
  ["профиль зашит, файл не читается", /source=compiled-in profile/.test(log)],
  ["баннер с профилем напечатан", banner.length > 0],
  ...Object.entries(PROFILE).map(([key, value]) => [
    "баннер: " + key + "=" + value,
    new RegExp("\\b" + key + "=" + value + "\\b").test(banner)
  ]),
  ["детур-транзакция завершилась", /boot: commit = /.test(log)],
  ["Extras-транзакция не поставила ни одного детюра", extras === "0" || extras === undefined],
  ["инициализация дошла до конца", /boot: done/.test(log)],
  ["сэмплер снял первый замер", /sample #1/.test(log)],
  ["глобалы 0x00D415B8/BC стковые", /ptr-check globals\s+@ 00D415B8 \[00000000, 00000000\]/.test(log)],
  // Формат строки журнала: время, pid, t+. Без pid два клиента одного каталога пишут в aw_probe.log
  // перемешанно, и любой счётчик, снятый с этого файла, описывает два процесса сразу (замер 04.10:
  // `t+12361s` и `t+118s` строки идут вперемешку)
  ["каждая строка журнала с pid процесса", (() => {
    const lines = log.split(/\r?\n/).filter((l) => l.trim() !== "");
    if (lines.length === 0) return false;
    return lines.every((l) => /^\d\d:\d\d:\d\d\.\d{3}\s+\d{2,7}\s+t\+\s*\d+s/.test(l));
  })()],
];
if (faulted) console.log("  внимание: транзакция упала в C0000005 -- стенд в этом запуске не пригоден для проверки состава детюров, перезапустите или смотрите в игре");

// Порядок публикации токена в источнике. FireEvent_inner раздаёт обработчики синхронно и читает аргументы
// с этого же стека, поэтому плейт обязан лежать в AW_NamePlates ДО NAME_PLATE_UNIT_ADDED: обратный порядок
// (был до 03.10) дал в клиенте Lua-error `attempt to index upvalue 'plate'` у ElvUI_ProjectZidras
// (Nameplates.lua:470) и молча пропущенное заполнение рамки у iTF. Снятие -- наоборот: обработчику REMOVED
// рамка ещё нужна, из карты её убирают после события.
{
  const srcFile = process.env.AW_LIB_SRC || path.join(root, "src", "AwesomeWotlkLib", "NamePlates.cpp");
  const cpp = fs.existsSync(srcFile) ? fs.readFileSync(srcFile, "latin1") : "";
  const pub = cpp.indexOf("platePublish(L, token");
  const added = cpp.indexOf("FireEvent(NAME_PLATE_UNIT_ADDED");
  const removed = cpp.indexOf("FireEvent(NAME_PLATE_UNIT_REMOVED");
  const unpub = cpp.indexOf("plateUnpublish(L, token");
  // Строчка `tail traffic` измеряет площадку, которой в профиле нет (tokenSite=0), и в бою она пишет
  // 15-секундный шум, который потом читается как «резолв сломан» -- правка 03.10 закрыла её guard'ом.
  const siteGuard = cpp.indexOf("if (S().tokenSite != 0)");
  const traffic = cpp.indexOf("tail traffic:");
  const probe = fs.readFileSync(path.join(root, "src", "AwesomeWotlkLib", "Probe.cpp"), "latin1");
  checks.push(
    ["источник: плейт опубликован до NAME_PLATE_UNIT_ADDED (pub=" + pub + " fire=" + added + ")",
      pub >= 0 && added >= 0 && pub < added],    ["источник: токен снят после NAME_PLATE_UNIT_REMOVED (fire=" + removed + " unpublish=" + unpub + ")",
      removed >= 0 && unpub >= 0 && removed < unpub],
    ["источник: tail traffic только при включённой площадке (guard=" + siteGuard + " traffic=" + traffic + ")",
      siteGuard >= 0 && traffic >= 0 && siteGuard < traffic],
    ["источник: в строку журнала печатается pid", /GetCurrentProcessId\(\)/.test(probe)
      && /%6lu/.test(probe)],
  );
}

// Дистанция (ярды до плейтов/цели/фокуса) выходит из dll ТОЛЬКО числами в уже существующие дата-таблицы.
// Всё, что здесь проверяется, -- цена одного прошлого разрыва сессии: C-замыкание или __gc в состоянии клиента это
// указатель внутрь dll, клиент сверяет его с диапазоном имиджа и кладёт процесс ERROR #134 (замер 29.09),
// а расширение этого диапазона -- измеренный причина разрыва сессии. Плюс порядок: тумблер обязан быть прочитан
// до раннего выхода по миру, иначе вышедший из мира игрок остаётся с меткой цели на экране.
{
  const srcFile = process.env.AW_LIB_SRC || path.join(root, "src", "AwesomeWotlkLib", "NamePlates.cpp");
  const cpp = fs.existsSync(srcFile) ? fs.readFileSync(srcFile, "latin1") : "";
  // Таблицу теперь заводит ensureGlobalTable (чинит и перехваченный чужим аддоном глобал, а не только
  // отсутствующий), поэтому проверяем сам факт создания, а не одну конкретную строку.
  const globalsRe = /(?:lua_setglobal|ensureGlobalTable)\(L, "AW_NamePlateDistances"\)/;
  const globalsMatch = globalsRe.exec(cpp);
  const globals = globalsMatch ? globalsMatch.index : -1;
  const gate = cpp.indexOf("if (S().distance) {");
  const switches = cpp.indexOf("readDistanceSwitches();");
  const inWorld = cpp.indexOf("if (!IsInWorld()) {");
  const platePush = cpp.indexOf("platePushDistance(L, entry, token,");
  const unitPush = (cpp.match(/pushUnitDistance\(L,/g) || []).length;
  const cvarLines = (cpp.match(/registerCVar\(&s_cvar_dist\w*.*\n?/g) || []);
  const withHandler = cvarLines.filter((l) => !/, NULL\);\s*$/.test(l.trim()));
  // Резолвер клиента на нерезолвящийся токен отвечает НЕ нулём (замер 30.09 00:20:35: 0xFFFFFFFFFFFFFFFE),
  // и объект по такому значению находится -- отсюда цифра дистанции при пустом фокусе (баг владельца 04.10
  // 15:5x). dll обязана отбраковывать эти значения, право «юнит есть» остаётся за UnitExists в аддоне.
  const sentinel = cpp.indexOf("0xFFFFFFFFFFFFFFFEULL");
  const sentinel2 = cpp.indexOf("0xFFFFFFFFFFFFFFFFULL");
  const reject = cpp.indexOf("if (guidResolved(guid))");
  checks.push(
    ["источник: неразрешённые guid цели/фокуса отбраковываются (reject=" + reject + " все1=" + sentinel2 + " все2=" + sentinel + ")",
      reject >= 0 && sentinel >= 0 && sentinel2 >= 0],
    ["источник: таблицы дистанции создаются под S().distance (gate=" + gate + " globals=" + globals + ")",
      gate >= 0 && globals >= 0 && gate < globals],
    ["источник: наружу идут только числа, ни одного C-указателя в Lua",
      !/lua_pushcfunction|luaL_Reg|lua_newmetatable|lua_setmetatable|lua_register\s*\(/.test(cpp)],
    ["источник: тумблеры читаются до раннего выхода по миру (switches=" + switches + " world=" + inWorld + ")",
      switches >= 0 && inWorld >= 0 && switches < inWorld],
    ["источник: метки плейтов обновляются в основном цикле", platePush >= 0],
    ["источник: цель и фокус печатаются оба", unitPush >= 4],
    // Снятый тумблер обязан НЕ пропускать проход по дистанциям, а пройти его с show=false: написанное
    // раньше остаётся в таблицах Lua, и метки зависают последними числами (замер владельца 04.10 21:1x).
    ["источник: проход дистанций идёт и при выключенном тумблере, гася написанное (плейты)",
      /platePushDistance\(L, entry, token,\s*\r?\n?\s*distWanted &&/.test(cpp)
      && !/if \(distWanted\) \{\s*\r?\n\s*for \(size_t/.test(cpp)],
    ["источник: цель и фокус гасятся тем же проходом при выключенном тумблере",
      /pushUnitDistance\(L, &posPlayer, "target", distWanted, 0\)/.test(cpp)
      && /pushUnitDistance\(L, &posPlayer, "focus", distWanted, 1\)/.test(cpp)],
    ["источник: у " + cvarLines.length + " переменной дистанции нет handler-а",
      cvarLines.length === 1 && withHandler.length === 0],
  );
}

// --- перенос стекинга свёрнут (08.10, решение владельца): гейт охраняет ОТСУТСТВИЕ -----------------
// Три прогона подряд кончились плохо -- при полной замене площадки размещения пропадали все плеиты
// (п. 76, п. 78), форма 'оригинал + смещения поверх' дала #132 внутри движка (п. 80). Файлы переноса из
// дерева удалены, поэтому проверка устроена как запрет на возврат: случайная правка, которая снова
// пристаптывает стекинг, обязана красный гейт, а не падение игрока. Мутация каждой строки проверена.
{
  const srcDir = path.join(root, 'src', 'AwesomeWotlkLib');
  const read = (f) => {
    const p2 = path.join(srcDir, f);
    return fs.existsSync(p2) ? fs.readFileSync(p2, 'latin1') : '';
  };
  const np = read('NamePlates.cpp'), probe = read('Probe.cpp');
  const settings = read('Settings.h'), desc = read('Settings.cpp'), cmake = read('CMakeLists.txt');
  const image = fs.existsSync(dll) ? fs.readFileSync(dll).toString('latin1') : '';
  const portFiles = ['PlateFrame.h', 'Stacking.h', 'Stacking.cpp', 'StackingSolver.h', 'StackingSolver.cpp'];
  const present = portFiles.filter((f) => fs.existsSync(path.join(srcDir, f)));
  checks.push(
    ['источник: файлов переноса в дереве нет (лишних: ' + present.length + ')',
      present.length === 0],
    ['источник: проект их не перечисляет', !/Stacking|PlateFrame/.test(cmake)],
    ['источник: ключа stacking нет ни в структуре профиля, ни в форматной строке баннера',
      !/stacking/i.test(settings) && !/stacking/i.test(desc)],
    ['источник: собранный образ не печатает и не содержит стекинг',
      image.length > 0 && !/stacking/i.test(image) && !/stacking=/i.test(banner)],
    ['источник: ни одна площадка стекинга не attach\'ится и проход не вызывается',
      np.indexOf('PatchUpdateNamePlatePositions') < 0 && np.indexOf('PatchWorldRenderDirty') < 0
      && np.indexOf('Stacking::') < 0 && np.indexOf('s_placePlates') < 0
      && probe.indexOf('Stacking') < 0],
    ['источник: единственный DetourAttach в NamePlates.cpp -- уровень плеита под sort',
      (np.match(/DetourAttach\(&\(LPVOID&\)/g) || []).length === 1
      && /if \(S\(\)\.sort && S\(\)\.scope >= 1\)/.test(np)],
  );
}

// --- /interact: канал данных и отказ от чтения полей (07.10) ------------------------------------
// Фича существует в двух половинах, которые не видят друг друга при сборке: Lua-аддон пишет имя в
// глобальную таблицу, dll читает её же по имени. Разойдись имена -- и команда молча ничего не делает,
// что и показало чтение журналов: за весь проект ни одной строки `interact: выбран`/`interact: ничего
// подходящего` во всех трёх клиентах (замер 07.10), при этом строка `cvar: 'interactionMode' = ...`
// есть -- то есть Update у interact работает, а запрос до dll ни разу не дошёл.
{
  // utf8, а не latin1, как в блоках выше: строки журнала проверяются по русскому тексту, и под latin1
  // гейт врал бы провалом на целой файловой кодировке (первый прогон 07.10 это и показал).
  const read = (p) => { const f = path.join(root, p); return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : ""; };
  const cpp = read(path.join("src", "AwesomeWotlkLib", "Interact.cpp"));
  const lua = read(path.join("addons", "AWNamePlateAPI", "AWInteract.lua"));
  const getGlobal = cpp.indexOf('lua_getglobal(L, "AW_Request")');
  const getField = cpp.indexOf('lua_getfield(L, -1, "interact")');
  const clear = cpp.indexOf('lua_setfield(L, -2, "interact")');
  const pushNil = cpp.lastIndexOf('lua_pushnil(L);', clear);
  const init = cpp.indexOf("Interact::initialize()");
  const gate = cpp.indexOf("if (!S().interact) return;");
  const reg = cpp.indexOf("registerOnUpdate(onUpdate)");
  const enumSite = cpp.indexOf("ObjectMgr::EnumObjects");
  const click = cpp.indexOf("vtableRightClick(again)");
  const keep = cpp.indexOf("s_pendingGuid = best");
  const readField = cpp.indexOf("if (!g_fieldsAt) return false;");
  checks.push(
    ["источник: имя канала совпадает в C++ и в Lua (getglobal=" + getGlobal + " getfield=" + getField + ")",
      getGlobal >= 0 && getField >= 0 && getGlobal < getField
      && /AW_Request\s*=\s*AW_Request\s+or\s+\{\}/.test(lua) && /AW_Request\.interact\s*=/.test(lua)],
    ["источник: запрос гасится самим же проходом (nil=" + pushNil + " set=" + clear + ")",
      clear >= 0 && pushNil >= 0 && pushNil < clear && pushNil > getField],
    ["источник: наружу идут только данные, ни одного C-указателя",
      !/lua_pushcfunction|luaL_Reg|lua_newmetatable|lua_register\s*\(/.test(cpp)
      && /type == LUA_TSTRING[\s\S]*type == LUA_TNUMBER \|\| type == LUA_TBOOLEAN/.test(cpp)],
    ["источник: ни одной правки кода клиента в interact",
      !/DetourAttach|DetourTransaction|patchBytes|VirtualProtect|forceWrite/.test(cpp)],
    ["источник: ключ профиля проверяется до регистрации CVar'ов и Update (gate=" + gate + " init=" + init + " reg=" + reg + ")",
      gate >= 0 && reg >= 0 && gate < reg && init >= 0 && gate > init],
    ["источник: клик отделён от обхода (enum=" + enumSite + " pending=" + keep + " click=" + click + ")",
      enumSite >= 0 && keep >= 0 && click >= 0 && keep < click && click > enumSite],
    ["источник: поля объекта не читаются, пока смещение массива не подтверждено", readField >= 0],
    ["источник: именованный юнит резолвится через токен-путь клиента",
      cpp.indexOf("ObjectMgr::GetGuidByUnitID(s_modifier)") >= 0],
    ["источник: прогон оставит след в журнале (выбор, пуст поиск, найденное смещение)",
      /interact: выбран/.test(cpp) && /interact: ничего подходящего/.test(cpp) && /interact: поля/.test(cpp)],
    ["аддон: обе команды объявлены и вызывают глобальную функцию",
      /SLASH_AWINTERACT1\s*=\s*"\/interact"/.test(lua) && /SLASH_AWINTERACT2\s*=\s*"\/smartinteract"/.test(lua)
      && /function AWInteract\(/.test(lua) && /SlashCmdList\["AWINTERACT"\]/.test(lua)],
  );
}

// Паритет с эталонным механизмом. Правило переноса: брать ЕГО формулу и ЕГО константы, а не «эквивалент».
// Поэтому сверка идёт по исходникам форка, а не по памяти о них: список типов го-объектов разворачивается
// из symbolic-имён через enum самого форка, индексы полей -- из OBJECT_END, клампы и конус -- из его строк.
{
  const rd = (p) => { const f = path.join(root, p); return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : ""; };
  const fork = rd(path.join("reference", "awesome-fork", "awesome_wotlk-main", "src", "AwesomeWotlkLib", "Misc.cpp"));
  const forkEnums = rd(path.join("reference", "awesome-fork", "awesome_wotlk-main", "src", "AwesomeWotlkLib", "Enums.h"));
  const cpp = rd(path.join("src", "AwesomeWotlkLib", "Interact.cpp"));
  if (!fork && !fs.existsSync(path.join(root, "reference", "awesome-fork"))) {
    // Публичный клон исходников: чужого дерева рядом нет по устройству репозитория, а не потому, что
    // оно потерялось. Здесь пропуск, а ниже -- по-прежнему провал: он ловит случай, когда material
    // на месте, но читается не то.
    checks.push(["паритет interact с форком: reference/awesome-fork рядом нет -- сверка пропущена", true]);
  } else if (!fork || !cpp) {
    checks.push(["паритет interact с форком: исходники не найдены -- сверка не сделана", false]);
  } else {
    // 1) GAMEOBJECT_TYPE_* из Enums.h -> числа; symbolic-список форка -> тот же набор чисел
    const enumVal = {};
    for (const m of forkEnums.matchAll(/GAMEOBJECT_TYPE_([A-Z_0-9]+)\s*=\s*(\d+)/g)) enumVal[m[1]] = +m[2];
    const forkListLine = (fork.match(/validTypes\s*=\s*\{([^}]*)\}/) || [ "", "" ])[1];
    const forkList = [...forkListLine.matchAll(/GAMEOBJECT_TYPE_([A-Z_0-9]+)/g)].map((m) => enumVal[m[1]]);
    const oursList = ((cpp.match(/kInteractableGoTypes\[\]\s*=\s*\{([^}]*)\}/) || [ "", "" ])[1])
      .split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n));
    // 2) индексы полей: у форка часть записей = OBJECT_END + 0xNN, часть -- прямое число; у нас те же
    // слагаемые в инициализаторе (6 + 0x35), поэтому сравниваются значения, а не текст
    const objectEnd = +((forkEnums.match(/OBJECT_END\s*=\s*(0x[0-9A-Fa-f]+|\d+)/) || [ 0, "0x6" ])[1].replace("0x", ""));
    const num = (t) => parseInt(t, /^0x/i.test(t) ? 16 : 10);
    const forkField = (sym) => {
      const rel = forkEnums.match(new RegExp(sym + "\\s*=\\s*OBJECT_END\\s*\\+\\s*(0x[0-9A-Fa-f]+|\\d+)"));
      if (rel) return objectEnd + num(rel[1]);
      const direct = forkEnums.match(new RegExp(sym + "\\s*=\\s*(0x[0-9A-Fa-f]+|\\d+)"));
      return direct ? num(direct[1]) : null;
    };
    const fieldPairs = [["FIELD_TYPE", "OBJECT_FIELD_TYPE"], ["FIELD_GO_BYTES1", "GAMEOBJECT_BYTES_1"],
      ["FIELD_UNIT_FLAGS", "UNIT_FIELD_FLAGS"], ["FIELD_UNIT_DYNFLAGS", "UNIT_DYNAMIC_FLAGS"],
      ["FIELD_UNIT_NPCFLAGS", "UNIT_NPC_FLAGS"]];
    const fieldDrift = fieldPairs.filter(([name, sym]) => {
      const ours = cpp.match(new RegExp(name + "\\s*=\\s*([^;]+);"));
      const want = forkField(sym);
      if (!ours || want === null) return true;
      const got = [...ours[1].matchAll(/0x[0-9A-Fa-f]+|\d+/g)].reduce((a, m) => a + num(m[0]), 0);
      return got !== want;
    }).map(([name]) => name);
    // 3) конус и радиус: угол делится пополам, направление нормализуется, предел 20 ярдов, клампы 15..160
    const coneFork = /g_iAngle \/ 2/.test(fork) && /dx \/= length/.test(fork) && /distance > 20\.0f/.test(fork);
    const coneOurs = /g_angle \/ 2\.f/.test(cpp) && /dx \/ length/.test(cpp) && /bestDistance = 20\.0f/.test(cpp);
    const clampFork = /Sync\(value, &g_iAngle, 15, 160/.test(fork) && /Sync\(value, &g_iMode, 0, 1/.test(fork);
    const clampOurs = /if \(a < 15\)[\s\S]{0,80}if \(a > 160\)/.test(cpp) && /m < 0[\s\S]{0,60}m > 1/.test(cpp);
    checks.push(
      ["паритет: список типов го-объектов = форк (" + oursList.join(",") + " против " + forkList.join(",") + ")",
        forkList.length > 0 && oursList.length === forkList.length &&
        [...oursList].sort((a, b) => a - b).join(",") === [...forkList].sort((a, b) => a - b).join(",")],
      ["паритет: индексы полей = OBJECT_END + дельты форка" + (fieldDrift.length ? ", расхождение: " + fieldDrift.join(",") : ""),
        fieldDrift.length === 0],
      ["паритет: конус -- половина угла и нормализованное направление (форк=" + coneFork + " мы=" + coneOurs + ")",
        coneFork && coneOurs],
      ["паритет: клампы CVar'ов 15..160 и режим 0..1 (форк=" + clampFork + " мы=" + clampOurs + ")",
        clampFork && clampOurs],
    );
  }
}

// --- поставка: без patcher'а игрок не загрузит dll, значит он в поставке обязательно ----------------
// Оригинальный AwesomeWotlkPatch.exe (FrostAtom, сборка 13.11.2022) патчует те же три площадки, и наш
// собран по его таблице: проверка читает её из src/AwesomeWotlkPatch/Patch.h и ищет получившиеся
// шестнадцатеричные строки в собранном образце -- один лишний ниббл в таблице делает гейт красным.
// Вторая проверка ровно про поставку: файл в публичном клоне обязан быть побайтово тем, что мы собрали,
// иначе игрок скачивает не то, что мы проверяли.
{
  const rd = (rp) => { const f = path.join(root, rp); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''; };
  const exePath = path.join(rel, 'AwesomeWotlkPatch.exe');
  const patchH = rd(path.join('src', 'AwesomeWotlkPatch', 'Patch.h'));
  const body = patchH.slice(patchH.indexOf('s_patches[]'), patchH.indexOf('};', patchH.indexOf('s_patches[]')));
  const sites = [];
  for (const m of body.matchAll(/\{([\s\S]*?)\n\s*\}/g)) {
    const addr = (m[1].match(/0x([0-9A-Fa-f]{6,8})/) || [])[1];
    const hex = [...m[1].matchAll(/"([0-9A-Fa-f]+)"/g)].map((h) => h[1].toUpperCase())
      .filter((h) => h.length % 2 === 0 && h.length >= 2).join('');
    if (addr && hex) sites.push({ addr: addr.toUpperCase(), hex });
  }
  const exe = fs.existsSync(exePath) ? fs.readFileSync(exePath).toString('latin1').toUpperCase() : '';
  const inExe = sites.filter((s) => exe.indexOf(s.hex) >= 0);
  const cloneDir = path.join(root, 'reference', 'itf_warmane_git');
  const clonePresent = fs.existsSync(path.join(cloneDir, '.git'));
  const sameBytes = (a, b) => fs.existsSync(a) && fs.existsSync(b) &&
    Buffer.compare(fs.readFileSync(a), fs.readFileSync(b)) === 0;
  const isPe32Gui = exe.length > 0x100 && (() => {
    const b = fs.readFileSync(exePath);
    const pe = b.readUInt32LE(0x3c);
    return b[0] === 0x4d && b[1] === 0x5a && b.readUInt16LE(pe + 4) === 0x14c &&
      b.readUInt16LE(pe + 24) === 0x10b && b.readUInt16LE(pe + 24 + 68) === 2;
  })();
  checks.push(
    ['поставка: в Patch.h ' + sites.length + ' площадки, все ' + inExe.length + ' лежат в собранном патчере',
      sites.length === 3 && inExe.length === sites.length],
    ['поставка: адреса площадок = 004DCCF0 / 004E5CB0 / 0040B7D0 (та же таблица, что у оригинала Atom)',
      sites.map((s) => s.addr).sort().join(',') === '0040B7D0,004DCCF0,004E5CB0'],
    ['поставка: патчер -- PE32 (i386) с GUI-подсистемой, как и Wow.exe 12340', isPe32Gui],
    // Два пина ниже имеют смысл только там, где рядом лежит клон поставки: в свежей выкачке исходников его
    // нет, и отсутствие клона -- не провал сборки, а просто другая машина.
    ['поставка: AwesomeWotlkPatch.exe в клоне = собранный у нас' + (clonePresent ? '' : ' (клона рядом нет)'),
      !clonePresent || sameBytes(path.join(cloneDir, 'AwesomeWotlkPatch.exe'), exePath)],
    ['поставка: AwesomeWotlkLib.dll в клоне = собранная у нас' + (clonePresent ? '' : ' (клона рядом нет)'),
      !clonePresent || sameBytes(path.join(cloneDir, 'AwesomeWotlkLib.dll'), dll)],
  );
}
let failed = 0;
console.log("--- проверки ---");
for (const [name, ok] of checks) { if (!ok) failed++; console.log((ok ? "  ok   " : "  FAIL ") + name); }
console.log(failed ? "ПРОВАЛОВ: " + failed : "OK: dll стартует с зашитым профилем scope=4 без падения процесса");
process.exit(failed);
