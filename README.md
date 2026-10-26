<p align="center">
  <img src="https://img.shields.io/badge/WotLK-3.3.5a%20build%2012340-blue?style=for-the-badge">
  <img src="https://img.shields.io/badge/platform-Windows%20x86-lightgrey?style=for-the-badge">
  <img src="https://img.shields.io/badge/status-stable-brightgreen?style=for-the-badge">
  <img src="https://img.shields.io/badge/license-GPL--3.0-orange?style=for-the-badge">
</p>

<h1 align="center">AwesomeWotlkLib — nameplate API &amp; QoL for Warmane</h1>

<p align="center">
  <b>A client library for WoW 3.3.5a that makes nameplates addressable as units,<br>
  plus a set of quality-of-life fixes driven by CVars.</b><br>
  <i>Unit("nameplate1") works — that is the whole point of this build.</i>
</p>

<p align="center">
  <a href="#english">English</a> ·
  <a href="#russian">Русский</a>
</p>

<p align="center">
  <b>made by <a href="https://discord.gg/sKpJbUrsvR">Keoo</a> for Warmane</b>
</p>

---

<a name="english"></a>
## English

<p align="center">
  <a href="#features-en">Features</a> ·
  <a href="#api-en">For addon authors</a> ·
  <a href="#commands-en">Commands</a> ·
  <a href="#config-en">Configuration</a> ·
  <a href="#install-en">Installation</a> ·
  <a href="#dev-en">Development</a> ·
  <a href="#license-en">License</a> ·
  <a href="#credits-en">Credits</a>
</p>

### About

**AwesomeWotlkLib.dll** is loaded by a patched `Wow.exe` (3.3.5a, build 12340) and gives the client three
things it never had:

1. **Nameplates as units.** Every health plate becomes addressable as `nameplate1 … nameplateN`, so
   `Unit("nameplate1")`, `UnitExists("nameplate2")` and secure attributes work the way they do on retail.
2. **`C_NamePlate`** — `GetNamePlateForUnit`, `GetNamePlateByGUID`, `GetNamePlateTokenByGUID`, plus the
   `NAME_PLATE_UNIT_ADDED` / `NAME_PLATE_UNIT_REMOVED` events.
3. **Quality-of-life CVars** — camera FOV, nameplate draw distance, camera occlusion fade, smart
   interaction, `@cursor` / `@playerlocation` macro conditionals, UTF-8 clipboard, distance in yards on
   plates and on the target/focus frames.

Everything is configured **in game through CVars** — the dll reads no config file, no environment variable
and no registry key. Which features exist at all is decided by the build.

<a name="features-en"></a>
### Features

#### Nameplate tokens

A token belongs to a plate for the plate's whole lifetime: a slot is held for three script updates after
the plate disappears, and live slots are never renumbered. This is what stops WeakAuras icons from jumping
between mobs when another plate dies.

#### C_NamePlate and events

`C_NamePlate.GetNamePlateForUnit(unit)`, `GetNamePlateByGUID(guid)` and `GetNamePlateTokenByGUID(guid)` are
published together with `NAME_PLATE_CREATED`, `NAME_PLATE_UNIT_ADDED` and `NAME_PLATE_UNIT_REMOVED`.

#### Camera

`cameraFov` changes the field of view and survives a camera switch. `cameraIndirectVisibility` (0/1) with
`cameraIndirectAlpha` (0.6–1.0) does not lock the camera behind an obstacle — it fades whatever stands
between the camera and your character.

#### Interaction

`/interact` picks the nearest lootable or usable object — within 20 yards, optionally inside your view cone
(`interactionMode`, `interactionAngle`) — and clicks it. `/interact target` acts on your current target.
Bind it with a macro: `/run AWInteract()`.

#### Clipboard

The Windows clipboard is handled as UTF-8, so Cyrillic copied out of chat no longer arrives as mojibake,
and the other way round too.

#### Addons shipped with it

* **AwesomeCVar** — the original CVar manager UI (`/awesome`), trimmed to exactly what this dll registers.
* **AWNamePlateAPI** — publishes `C_NamePlate` and the token table, fixes load order for consumers, and
  carries `/interact` (second file `AWInteract.lua`: the slash command and the data channel).
* **iTargetingFrames** — ported to 3.3.5a and driven by the nameplate tokens (auras polled, not evented).
* **Flash** — inert here on purpose: it needs `FlashWindow()`, which this dll does not provide.

<a name="api-en"></a>
### For addon authors

- `Unit("nameplate1")`, `UnitExists("nameplate2")` — the unit behind that plate, or nil.
- `C_NamePlate.GetNamePlateForUnit("target")` — the plate frame of a unit.
- `C_NamePlate.GetNamePlateByGUID(guid)` / `GetNamePlateTokenByGUID(guid)` — the `nameplateN` token.
- `AW_NamePlateTokens[guid]` — token by GUID, a plain data table.
- `NAME_PLATE_UNIT_ADDED` / `NAME_PLATE_UNIT_REMOVED` — fired with the unit token as the argument.

**The client does not send `UNIT_AURA`, `UNIT_HEALTH` or `UNIT_SPELLCAST_*` for these tokens.** A display
addon has to poll them — `AWNamePlateAPI` and the ported `iTargetingFrames` do it every 0.2 s. Anything that
expects an event will silently freeze the icon instead of updating it.

<a name="commands-en"></a>
### Commands

- `/awesome` — open the CVar manager.
- `/awesome show`, `hide`, `toggle` — window control.
- `/awesome reset` — reset every supported CVar to its built-in default.
- `/interact` — loot or use the nearest eligible object.
- `/interact target` — act on your current target; also accepts `focus`, `mouseover`, `nameplate1` and other units.
- `/smartinteract` — same as `/interact`.
- `/run AWInteract()` — for keybinds and macros.
- `/console cameraFov 120` — and any other CVar from the list below.

<a name="config-en"></a>
### Configuration

All seven settings below are ordinary CVars: the client saves them into `Config.wtf`, and `/awesome` edits
them.

- `nameplateDistance` — 41–100, default 43. Largest distance at which plates are still shown.
- `cameraFov` — 60–150, default 100. Camera field of view (100 = stock 90°).
- `cameraIndirectVisibility` — 0 or 1, default 0. Fade world objects between the camera and the player.
- `cameraIndirectAlpha` — 0.6–1.0, default 0.6. How transparent those objects become.
- `interactionMode` — 0 or 1, default 1. 0 = radius, 1 = view cone only.
- `interactionAngle` — 15–160, default 60. Full cone angle for `/interact`, in degrees.
- `distanceDisplay` — 0 or 1, default 0. Compute the yard numbers at all.

The **Distance** tab of `/awesome` is not a CVar list: font, outline, size, colour, anchor, side, offsets
and the range limit live per plate type in `AWDistanceDB` (SavedVariables of AWNamePlateAPI), because a
CVar table cannot carry forty of them honestly. Long lists there scroll instead of running off the screen.

There is no settings file — the feature set is compiled in (`src/AwesomeWotlkLib/Settings.h`).

<a name="install-en"></a>
### Installation

1. Build the dll, or take a released one:
   ```
   cmake -S . -B reference/build -G "Visual Studio 18 2026" -A Win32 -T host=x64 -DAW_BUILD_TESTS=ON
   cmake --build reference/build --config Release
   ```
2. Put `AwesomeWotlkLib.dll` next to `Wow.exe`. That `Wow.exe` must already be patched to load the
   library — this repository does not patch the executable.
3. Copy the folders from `addons/` into `Interface\AddOns\` and enable **AWNamePlateAPI** and
   **AwesomeCVar** (plus **iTargetingFrames** if you use it).
4. WeakAuras needs a load-order hint; one command does it:
   ```
   node tools/patch_weakauras_toc.js "D:\Games\World of Warcraft"
   ```
   Without it WeakAuras decides the client is unpatched before its own `Init.lua` runs, and nameplate
   triggers never build. Check in game: `/dump WeakAuras.IsAwesomeEnabled()` — not `nil`.
5. Launch, log in, `/awesome`.

The player pack is published on GitLab: [keoo88/iTargetingFrames_warmane, release `v0.5`](https://gitlab.com/keoo88/iTargetingFrames_warmane/-/releases/v0.5).
The sources are mirrored on GitHub: [Keoo888/iTargetingFrames_warmane](https://github.com/Keoo888/iTargetingFrames_warmane).
— dll `a4ac17f132c4cb5c05dec84f9d32fc3f` (245 760 bytes), the patcher `AwesomeWotlkPatch.exe`
(409 600 bytes, md5 `2773484778adb485b96f50f777c4b8e5`) and the three addon folders, 54 files, 488 861 bytes,
sha256 `9d613dc9d14e8a399150e2c03b216300cf951c89e2e73f2edf4518e91389d49f`. Without the patcher the client never
reads the dll, so it ships in the pack. Sources, docs and gates stay in this repository.

### Compatibility

* Built and tested on **Warmane**, WoW 3.3.5a client **build 12340**, Interface `30300`.
* Every client address is measured on that build. On another build the addresses have to be re-measured —
  no gate in this repository can do that for you.
* Developed exclusively for **Warmane**. No responsibility for other servers.

### Why it stays clean

The library keeps **no pointer to our module inside client data**: no `lua_CFunction` registrations, no
`__gc` metamethods, no CVar handlers. Those are exactly the pointers the client validates at call time, and
what kills the process with `ERROR #134`. The public API is data tables plus Lua-side shims, and CVars are
polled instead of hooked. The pointer-range globals that upstream awesome overwrites (`0x00D415B8` /
`0x00D415BC`) are the measured cause of session breaks and are left stock here. The full analysis, including the
runs that proved it, is in [`docs/TECHNICAL.md`](docs/TECHNICAL.md).

<a name="dev-en"></a>
### Development

```
node tools/run_dll_smoke.js        # 62 checks: the compiled profile, a crash-free boot path, the publish/fire order, the log line format, plain numbers only for distances, the /interact channel and its constants, and six pins that the stacking port is gone from the tree (no files, no key, no site attached, the built image says nothing about it)
node tools/run_addon_lint.js       # Lua 5.1 syntax, locale completeness, encoding, text hygiene, iTF grid rebuild
node tools/run_addon_behavior.js   # 319 checks of the addons' data logic in fengari, no client needed (the C_NamePlate shim vs WeakAuras' own check, the ElvUI plate identity, the clickable Discord link, the cast bar ported from ElvUI_ProjectZidras, the distance labels and the Distance tab, the /interact channel dispatched by ChatFrame.lua's own rules, seven window rows against seven dll variables)
node tools/run_cvar_contract.js    # 7 addon rows vs the clamps extracted from the C++ sources (no stacking rows -- п. 80)
node tools/run_deploy_parity.js    # installed addons vs the repository, byte for byte, both directions
node tools/run_itf_layout_check.js # 47 checks: grid slot compaction, the npcID parser, a model of the 3.3.5a state driver, the driver reference order, the grid geometry, the frame identity refresh, the spell-id range, the NPC blacklist slots, its entry in the options panel, locale completeness, the cast poll, the whole deny chain matched by attribute name, the indicator state existing from the moment a frame is created, the slot number crossing the secure/insecure border as an attribute, and every indicator name offered by the options being declared by the state factory, plus three orderings in the options window -- the legacy-config wipe before the sub-tables it would destroy, slider limits read before the wheel branches, and the loadstring reason reaching the player (fengari)
node tools/run_dead_code_check.js  # dead locals (threshold zero) and reads of outside names against tools/dead_code_baseline.json
```

```
src/AwesomeWotlkLib/   the dll
src/AwesomeWotlkPatch/ the shipped patcher: same three sites as upstream's table, our own build
deps/Detours/          Microsoft Detours, vendored
addons/                AWNamePlateAPI (C_NamePlate + /interact + ElvUI plate identity), AwesomeCVar, iTargetingFrames
tools/                 the six gates above, patch_weakauras_toc.js, address helpers
docs/TECHNICAL.md      deep notes: addresses, measurements, why each decision was taken
plan.md                dated work journal — history is never rewritten
reference/             third-party and archived material: the awesome fork, old snapshots, build output
```

`reference/` is not part of a delivery, and neither the dll nor any gate reads from it.

The gates need `luaparse` and `fengari`, which are not vendored here. Either install them in `tools/`
(`npm i luaparse fengari`) or point at an existing copy: `AW_LUAPARSE`, `AW_FENGARI`. The sandbox paths
default to my own test client and can be overridden with `AW_ADDONS_DIR` / `AW_CLIENT_DIR`.

<a name="license-en"></a>
### License

This project is distributed under the GNU General Public License v3.0, the same
license as the upstream [FrostAtom/awesome_wotlk](https://github.com/FrostAtom/awesome_wotlk).
See [LICENSE](LICENSE). Detours and the other bundled components keep their own licenses.

<a name="credits-en"></a>
### Credits

* Upstream project: [FrostAtom/awesome_wotlk](https://github.com/FrostAtom/awesome_wotlk) — the base this tree was rebuilt from
* Detours: [Microsoft/Detours](https://github.com/microsoft/Detours)
* WeakAuras for WotLK: [NoM0Re/WeakAuras-WotLK](https://www.github.com/NoM0Re/WeakAuras-WotLK)
* iTargetingFrames: original by **Ironi**, WotLK backport by **Cheeta**
* AwesomeCVar: original by **noname08662**
* Warmane build, nameplate API and all the measuring: **Keoo** — [Discord](https://discord.gg/sKpJbUrsvR)

---

<a name="russian"></a>
## Русский

<p align="center">
  <a href="#возможности-ru">Возможности</a> ·
  <a href="#api-ru">Авторам аддонов</a> ·
  <a href="#команды-ru">Команды</a> ·
  <a href="#настройки-ru">Настройки</a> ·
  <a href="#установка-ru">Установка</a> ·
  <a href="#разработка-ru">Разработка</a> ·
  <a href="#лицензия-ru">Лицензия</a> ·
  <a href="#благодарности-ru">Благодарности</a>
</p>

### О проекте

**AwesomeWotlkLib.dll** подгружается пропатченным `Wow.exe` (3.3.5a, сборка 12340) и даёт клиенту три вещи,
которых в нём никогда не было: индикаторы здоровья становятся юнитами (`nameplate1 … nameplateN`),
появляется `C_NamePlate` с событиями `NAME_PLATE_UNIT_*`, а набор бытовых исправлений управляется обычными
CVar'ами. Всё настраивается **в игре**: файл настроек, переменные окружения и реестр dll не читает в
принципе — состав фич решает сборка.

<a name="возможности-ru"></a>
### Возможности

#### Токены индикаторов

Номер живёт столько, сколько живёт сам индикатор: слот удерживается три скриптовых обновления после
исчезновения плейта, а живые слоты не перенумеровываются. Именно поэтому иконки WeakAuras больше не
перепрыгивают между мобами, когда рядом умирает ещё один индикатор.

#### C_NamePlate и события

`C_NamePlate.GetNamePlateForUnit(unit)`, `GetNamePlateByGUID(guid)`, `GetNamePlateTokenByGUID(guid)` и
события `NAME_PLATE_CREATED`, `NAME_PLATE_UNIT_ADDED`, `NAME_PLATE_UNIT_REMOVED`.

#### Камера

`cameraFov` меняет угол обзора и переживает смену камеры. `cameraIndirectVisibility` (0/1) вместе с
`cameraIndirectAlpha` (0.6–1.0) не выпускают камеру за препятствие, а делают полупрозрачным то, что стоит
между камерой и персонажем.

#### Взаимодействие

`/interact` берёт ближайший подбираемый или используемый объект — в радиусе 20 ярдов, при желании внутри
конуса взгляда (`interactionMode`, `interactionAngle`) — и кликает по нему. `/interact target` работает с
текущей целью. На клавишу вешается макросом `/run AWInteract()`.

#### Буфер обмена

Обмен с Windows идёт в UTF-8: кириллица из чата больше не превращается в кракозябры при копировании в
блокнот, и обратно тоже.

#### Аддоны в комплекте

* **AwesomeCVar** — оригинальный менеджер CVar'ов (`/awesome`, вкладки, ползунки, radio), оставлен ровно в
  том объёме, который регистрирует dll.
* **AWNamePlateAPI** — публикует `C_NamePlate` и таблицу токенов, чинит порядок загрузки и носит в себе
  `/interact` (второй файл `AWInteract.lua`: слэш-команда и канал данных).
* **iTargetingFrames** — портирован под 3.3.5a и работает с токенами индикаторов (ауры опросом).
* **Flash** — здесь намеренно ничего не делает: нужны `FlashWindow()`, а их dll не даёт.

<a name="api-ru"></a>
### Авторам аддонов

- `Unit("nameplate1")`, `UnitExists("nameplate2")` — юнит за этим индикатором или nil.
- `C_NamePlate.GetNamePlateForUnit("target")` — фрейм индикатора цели.
- `C_NamePlate.GetNamePlateByGUID(guid)` / `GetNamePlateTokenByGUID(guid)` — токен `nameplateN`.
- `AW_NamePlateTokens[guid]` — токен по гиду, обычная таблица данных.
- `NAME_PLATE_UNIT_ADDED` / `NAME_PLATE_UNIT_REMOVED` — событие с юнит-токеном в аргументе.

**Клиент не рассылает `UNIT_AURA`, `UNIT_HEALTH` и `UNIT_SPELLCAST_*` для этих токенов.** Аддон обязан
опрашивать их сам — `AWNamePlateAPI` и портированный `iTargetingFrames` делают это каждые 0,2 с. Всё, что
рассчитывает на событие, молча заморозит иконку вместо обновления.

<a name="команды-ru"></a>
### Команды

- `/awesome` — открыть менеджер CVar'ов.
- `/awesome show`, `hide`, `toggle` — окно: показать, скрыть, переключить.
- `/awesome reset` — сбросить все поддерживаемые CVar к встроенным значениям.
- `/interact` — взять или использовать ближайший подходящий объект.
- `/interact target` — пройтись по текущей цели; также принимает `focus`, `mouseover`, `nameplate1` и другие юниты.
- `/smartinteract` — то же, что `/interact`.
- `/run AWInteract()` — для биндов и макросов.
- `/console cameraFov 120` — и любой CVar из списка ниже.

<a name="настройки-ru"></a>
### Настройки

Все семь настроек ниже — обычные CVar'ы: клиент сам сохраняет их в `Config.wtf`, правятся из `/awesome`.

- `nameplateDistance` — 41–100, по умолчанию 43. Максимальная дистанция отображения индикаторов.
- `cameraFov` — 60–150, по умолчанию 100. Угол обзора камеры (100 = штатные 90°).
- `cameraIndirectVisibility` — 0 или 1, по умолчанию 0. Затемнять объекты между камерой и персонажем.
- `cameraIndirectAlpha` — 0.6–1.0, по умолчанию 0.6. Насколько именно прозрачными.
- `interactionMode` — 0 или 1, по умолчанию 1. 0 — радиус, 1 — только конус взгляда.
- `interactionAngle` — 15–160, по умолчанию 60. Полный угол конуса для `/interact`, в градусах.
- `distanceDisplay` — 0 или 1, по умолчанию 0. Считать ли ярды вообще.

Вкладка **Distance** окна `/awesome` — не список CVar'ов: шрифт, контур, размер, цвет, привязка, сторона,
смещения и предел скрываются по типу индикатора в `AWDistanceDB` (SavedVariables аддона AWNamePlateAPI),
потому что сорок значений честной таблицей переменных не выкладываются. Длинные списки там прокручиваются,
а не уходят за край экрана.

Файла настроек нет: что вообще существует в сборке, решает `src/AwesomeWotlkLib/Settings.h`.

<a name="установка-ru"></a>
### Установка

1. Собрать dll (или взять готовый релиз):
   ```
   cmake -S . -B reference/build -G "Visual Studio 18 2026" -A Win32 -T host=x64 -DAW_BUILD_TESTS=ON
   cmake --build reference/build --config Release
   ```
2. `AwesomeWotlkLib.dll` — в каталог клиента, рядом с `Wow.exe`. Сам `Wow.exe` должен уже быть пропатчен
   под загрузку библиотеки: этот репозиторий исполняемый файл не патчит.
3. Папки из `addons/` — в `Interface\AddOns\`, включить **AWNamePlateAPI** и **AwesomeCVar**
   (и **iTargetingFrames**, если он нужен).
4. WeakAuras нуждается в подсказке о порядке загрузки — одна команда:
   ```
   node tools/patch_weakauras_toc.js "D:\Games\World of Warcraft"
   ```
   Без неё WeakAuras решает, что клиент не патчен, ещё до своей `Init.lua`, и nameplate-триггеры не
   собираются. Проверка в игре: `/dump WeakAuras.IsAwesomeEnabled()` — не `nil`.
5. Запустить игру, залогиниться, `/awesome`.

Готовый архив для игроков публикуется на GitLab: [keoo88/iTargetingFrames_warmane, релиз `v0.5`](https://gitlab.com/keoo88/iTargetingFrames_warmane/-/releases/v0.5).
Исходники отзеркалены на GitHub: [Keoo888/iTargetingFrames_warmane](https://github.com/Keoo888/iTargetingFrames_warmane).
— dll `a4ac17f132c4cb5c05dec84f9d32fc3f` (245 760 байт), патчер `AwesomeWotlkPatch.exe`
(409 600 байт, md5 `2773484778adb485b96f50f777c4b8e5`) и три папки аддонов, 54 файла, 488 861 байт,
sha256 `9d613dc9d14e8a399150e2c03b216300cf951c89e2e73f2edf4518e91389d49f`. Без патчера клиент dll не читает,
поэтому он в поставке. Исходники, документация и гейты остаются здесь.

### Совместимость

* Собрано и проверено на **Warmane**, клиент WoW 3.3.5a **build 12340**, Interface `30300`.
* Все адреса клиента замерены на этой сборке. На другой сборке их надо мерить заново — ни один гейт этого
  репозитория за тебя этого не сделает.
* Разрабатывалось исключительно для **Warmane**; за другие сервера ответственности нет.

### Почему это не вызывает разрыв сессии

Библиотека **не хранит указателей на себя в данных клиента**: ни `lua_CFunction`-регистраций, ни
`__gc`-метаметодов, ни handler'ов CVar'ов — именно такие указатели клиент проверяет в момент вызова и
убивает процесс ошибкой `ERROR #134`. Публичный API — таблицы данных и Lua-шимы поверх, а CVar'ы
опрашиваются, а не хукаются. Глобалы диапазона указателей `0x00D415B8` / `0x00D415BC`, которые раздвигает
апстрим, — измеренная причина разрыва сессии; здесь они стковые. Полный разбор и прогоны, которыми это доказано,
— в [`docs/TECHNICAL.md`](docs/TECHNICAL.md).

<a name="разработка-ru"></a>
### Разработка

```
node tools/run_dll_smoke.js        # 62 проверки: зашитый профиль, путь загрузки без падения, порядок публикация/событие, формат строки журнала, что дистанции выходят только числами, канал /interact и его константы, и шесть пинов что переноса стекинга в дереве нет (ни файлов, ни ключа, ни площадки, в образе ни слова о стекинге)
node tools/run_addon_lint.js       # синтаксис Lua 5.1, полнота локалей, кодировка, чистота текста, пересборка сетки iTF
node tools/run_addon_behavior.js   # 319 проверки логики данных аддонов в fengari, без клиента (shim C_NamePlate против условия WeakAuras, идентичность плеитов ElvUI, клик по ссылке-адресу, перенос полосы каста, метки дистанции и вкладка Distance, канал /interact по правилам ChatFrame.lua, семь строк окна против семи переменных dll)
node tools/run_cvar_contract.js    # 7 строк аддона против клампов, вытащенных из C++ (стекинговых строк больше нет -- п. 80)
node tools/run_deploy_parity.js    # установленное против репозитория, побайтово, в обе стороны
node tools/run_itf_layout_check.js # 47 проверок: уплотнение слотов сетки, парсер npcID, модель менеджера состояний 3.3.5a, порядок ref/_onstate, геометрия фона, переполнение рамки по смене юнита, диапазон id спеллов, чёрный список NPC и его пункт в окне настроек с полнотой локалей, опрос каста, сквозная проверка цепочки запрета по имени атрибута, наличие состояния индикаторов у только что созданной рамки, номер слота через границу secure/insecure атрибутом и полнота этих имён в списке настроек, плюс три порядка в окне настроек -- сброс старого конфига до подтаблиц, пределы полосы до ветвления по колесу, текст ошибки условки до игрока (fengari)
node tools/run_dead_code_check.js  # мёртвые локалы (порог 0) и чтения внешних имён против tools/dead_code_baseline.json
```

```
src/AwesomeWotlkLib/   dll
src/AwesomeWotlkPatch/ патчер, который уходит в поставку: те же три площадки, что в таблице
                       апстрима, но наша сборка
deps/Detours/          Microsoft Detours, вендорится
addons/                AWNamePlateAPI (C_NamePlate + /interact + ElvUI plate identity), AwesomeCVar, iTargetingFrames
tools/                 шесть гейтов выше, patch_weakauras_toc.js и помощники по адресам
docs/TECHNICAL.md      глубокие заметки: адреса, замеры, почему принято каждое решение
plan.md                датированный журнал: история не переписывается
reference/             чужое и архивное: форк awesome, старые снимки, артефакты сборки
```

`reference/` в поставку не входит, и ни dll, ни гейты оттуда ничего не читают.

Гейтам нужны `luaparse` и `fengari` — они не вендорятся. Либо `npm i luaparse fengari` в `tools/`, либо
указать на уже стоящую копию через `AW_LUAPARSE` / `AW_FENGARI`. Пути к тестовому клиенту по умолчанию —
моя песочница, перекрываются `AW_ADDONS_DIR` / `AW_CLIENT_DIR`.

<a name="лицензия-ru"></a>
### Лицензия

Проект распространяется по GNU General Public License v3.0 — той же лицензии,
что и upstream [FrostAtom/awesome_wotlk](https://github.com/FrostAtom/awesome_wotlk).
Подробности — в [LICENSE](LICENSE). Detours и другие встроенные компоненты
сохраняют свои лицензии.

<a name="благодарности-ru"></a>
### Благодарности

* Базовый проект: [FrostAtom/awesome_wotlk](https://github.com/FrostAtom/awesome_wotlk)
* Detours: [Microsoft/Detours](https://github.com/microsoft/Detours)
* WeakAuras для WotLK: [NoM0Re/WeakAuras-WotLK](https://www.github.com/NoM0Re/WeakAuras-WotLK)
* iTargetingFrames: оригинал — **Ironi**, бэкпорт на WotLK — **Cheeta**
* AwesomeCVar: оригинал — **noname08662**
* Сборка для Warmane, nameplate-API и все замеры: **Keoo** — [дискорд](https://discord.gg/sKpJbUrsvR)
