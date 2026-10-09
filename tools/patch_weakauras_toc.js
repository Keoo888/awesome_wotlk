// Делает nameplate-токены видимыми для WeakAuras: в ## OptionalDeps его WeakAuras.toc должен быть
// перечислен AWNamePlateAPI, иначе WeakAuras решает «клиент не патчен» ещё до своей Init.lua.
//
//   node tools/patch_weakauras_toc.js [каталог клиента]
//
// Замер 29.09 22:0x: WeakAuras вычисляет isAwesomeEnabled ОДИН раз при загрузке Init.lua
// (`C_NamePlate and C_NamePlate.GetNamePlateForUnit and 1`, Init.lua:391). Если AWNamePlateAPI не обязан
// загружаться раньше, значение = nil, и ветки nameplate-триггеров (BuffTrigger2.lua:1089/:1305,
// AuraEnvironment.lua:149) не собираются -- иконки не появляются, без единой ошибки.
//
// Именно OptionalDeps, а не Dependencies: в 3.3.5 отсутствующий или выключенный аддон в Dependencies
// блокирует загрузку носителя целиком, а тут нужна только очерёдность загрузки.
//
// Скрипт идемпотентен: уже есть строка -- ничего не делает. Пишет только в указанный каталог клиента
// (по умолчанию песочница D:/Games/WowAwesome); чужие установки не трогает, пока путь не передан явно.

const fs = require('fs');
const path = require('path');

const clientDir = process.argv[2] || process.env.AW_CLIENT_DIR || 'D:/Games/WowAwesome';
const tocPath = path.join(clientDir, 'Interface', 'AddOns', 'WeakAuras', 'WeakAuras.toc');
const NEED = 'AWNamePlateAPI';

if (!fs.existsSync(tocPath)) {
  console.log('FAIL: нет ' + tocPath + ' -- WeakAuras в этом клиенте не установлен (или путь другой)');
  process.exit(2);
}

const before = fs.readFileSync(tocPath, 'utf8');
const lines = before.split(/\r?\n/);
const idx = lines.findIndex((l) => /^\s*##\s*OptionalDeps\s*:/i.test(l));

if (idx < 0) {
  console.log('FAIL: в ' + path.relative(clientDir, tocPath) + ' нет строки ## OptionalDeps -- править некуда, добавь вручную');
  process.exit(1);
}

if (new RegExp('\\b' + NEED + '\\b').test(lines[idx])) {
  console.log('уже готово: ' + tocPath);
  console.log('  ' + lines[idx].trim());
  process.exit(0);
}

const fixed = lines[idx].replace(/\s*$/, '') + ', ' + NEED;
lines[idx] = fixed;
fs.writeFileSync(tocPath, lines.join('\r\n'), 'utf8');

console.log('до:   ' + lines[idx].replace(', ' + NEED, '').trim());
console.log('после: ' + fixed.trim());
console.log('Проверка в игре: /dump WeakAuras.IsAwesomeEnabled()  -> 1 (или 2), не nil.');
console.log('Если аддоны были включены в этом входе -- /reload или перезаход: порядок загрузки считается при старте.');
