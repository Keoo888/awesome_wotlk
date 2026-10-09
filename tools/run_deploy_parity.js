// Сверяет установленные в песочнице аддоны с репозиторием: файл в репо, которого нет в песочнице, или
// файл с другим содержимым -- это «проверяли не то, что собирали».
//
//   node tools/run_deploy_parity.js [путь_к_Interface\AddOns]
//
// По умолчанию песочница D:\Games\WowAwesome -- тестовый клиент по слову владельца (04.10 15:2x,
// «D:\Games\WowAwesome сюда положи»; C:\Games\Test -- прежний стенд, C:\Games\Elvui -- его личная
// установка). Дефолт менялся 03.10 после случая «совпадает 147»: гейт сверял не ту папку, где правку
// реально раскладывали, и врал зелёным.
// Смотрятся только каталоги тех аддонов, что лежат в
// репозитории, и смотрятся в обе стороны: файл из репо, которого нет в песочнице; файл с другим
// содержимым; и файл, который в песочнице есть, а в репозитории его нет. Последний случай -- это мусор от
// развёртывания (копия локали в корне аддона вместо Locales/: .toc её не грузит, значит правишь один файл,
// а работает другой). Чужое содержимое песочницы (WeakAuras и прочие каталоги) гейт по-прежнему не
// касается -- правку чужого .toc проверяют руками, см. docs/TECHNICAL.md, п. 12 и README, «Installation».
//
// Проверяется побайтовое совпадение (md5), а не «не старше»: mtime перезаписи ничего не гарантирует.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const repoAddons = path.join(root, 'addons');
const addOnsDir = process.argv[2] || process.env.AW_ADDONS_DIR || 'D:/Games/WowAwesome/Interface/AddOns';

if (!fs.existsSync(addOnsDir)) {
  console.log('FAIL: каталог аддонов не найден: ' + addOnsDir + ' (передать вторым аргументом)');
  process.exit(2);
}

const md5 = (file) => crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex').slice(0, 8);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : [full];
  });
}

let same = 0, stale = 0, missing = 0, extra = 0, skipped = 0;
const problems = [];
for (const addon of fs.readdirSync(repoAddons)) {
  const repoDir = path.join(repoAddons, addon);
  if (!fs.statSync(repoDir).isDirectory()) continue;
  // Каталог без `.toc` с своим именем на верхнем уровне -- не аддон: клиент его не грузит в принципе
  // (у WoW путь фиксирован: AddOns\<Имя>\<Имя>.toc). Такой каталог, как распакованный zip
  // `Имя-main\Имя\...` -- архивная копия, а не поставка, и сверять её с установленным бессмысленно.
  if (!fs.existsSync(path.join(repoDir, addon + '.toc'))) {
    skipped++;
    console.log('пропущено (не аддон, нет ' + addon + '/' + addon + '.toc): ' + addon);
    continue;
  }
  const installedDir = path.join(addOnsDir, addon);
  const rels = new Set();
  for (const file of walk(repoDir)) {
    const rel = path.relative(repoDir, file).split(path.sep).join('/');
    rels.add(rel.toLowerCase());
    const installed = path.join(installedDir, rel);
    if (!fs.existsSync(installed)) {
      missing++;
      problems.push('отсутствует в песочнице: ' + addon + '/' + rel);
      continue;
    }
    if (md5(file) === md5(installed)) { same++; continue; }
    stale++;
    problems.push('различается: ' + addon + '/' + rel + '  репо ' + md5(file) + ' vs песочница ' + md5(installed));
  }
  // Обратное направление: что лежит в установленном каталоге и чего нет в репозитории. Только для наших
  // аддонов -- чужие каталоги сюда не попадают, потому что цикл идёт по readdirSync(repoAddons).
  if (fs.existsSync(installedDir)) {
    for (const file of walk(installedDir)) {
      const rel = path.relative(installedDir, file).split(path.sep).join('/');
      if (rels.has(rel.toLowerCase())) continue;
      extra++;
      problems.push('лишнее в песочнице: ' + addon + '/' + rel + ' -- в репозитории такого файла нет');
    }
  }
}

for (const p of problems) console.log('  ' + p);
console.log(stale + missing + extra === 0
  ? 'Паритет: зелёный -- ' + same + ' файлов репозитория побайтово совпадают с установленными в ' + addOnsDir
  : 'Паритет: ПРОВАЛ -- совпадает ' + same + ', расходится ' + stale + ', не установлено ' + missing + ', лишнее в песочнице ' + extra);
process.exit(stale + missing + extra === 0 ? 0 : 1);
