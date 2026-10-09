#pragma once
#include <string>

// Профиль сборки зашит сюда. Считывать настройки извне (файл рядом с Wow.exe, переменные окружения,
// реестр) dll не может по решению владельца от 01.10: в оригинале awesome_wotlk их нет, и для нас они
// бесполезны -- всё, что игрок хочет переключать, и так живёт в CVar'ах (см. docs/TECHNICAL.md, п. 8 и п. 10).
//
// Значения = состояние, подтверждённое прогонами на Warmane (даты и замеры в plan.md):
struct PlateSettings {
    // Принято в игре: токен nameplateN + таблицы C_NamePlate + события NAME_PLATE_* + CVar nameplateDistance.
    int scope = 4;
    bool tokenResolve = true;   // "nameplateN" разрезается через 0x0060AFAA
    // Единственный профиль, который и резолвит токен из Lua, и остаётся чистым: правка 0x0060AFAA +
    // обратный резолв 0x0060BB70. Хвост 0x0060AD4B -- тупик (цепочка парсинга съедает токен раньше),
    // обёртка 0x0060C1C0 из Lua не вызывается.
    int tokenSite = 0;

    bool camera = true;     // CVar cameraFov + Camera::Initialize 0x00607C20
    bool macros = true;     // @cursor / @playerlocation
    bool clipboard = true;  // буфер обмена в UTF-8
    bool fade = true;       // затемнение моделей между камерой и игроком (вкл/выкл -- CVar cameraIndirectVisibility)
    bool interact = true;   // умный interact (правок кода нет; аддон AWNamePlateAPI, AWInteract.lua пишет AW_Request.interact)
    // Ярды до плейтов/цели/фокуса в AW_NamePlateDistances и AW_UnitDistances; рисует AWDistance.lua.
    // Игроку оставлен тумблер distanceDisplay (0 по умолчанию) -- как у fade, код в профиле, а видно ли
    // это на экране, решает CVar.
    bool distance = true;

    // Не подтверждено ни одним прогоном -- оставляем выключенным, код на месте.
    bool sort = false;      // сортировка нативных плейтов: лишняя правка .text на 0x0098E9F9
    bool namegate = false;  // не объявлять плейт, пока его имя = "Unknown Being" (меняет момент появления токена)

    // Ноль байт правки в Wow.exe и никакого авто-режима: глобалы 0x00D415B8/BC -- измеренный носитель
    // разрыва сессии (патч глобал + E9 в резолвере -> разрыв сессии на 5м26с; стковые глобалы + тот же E9 -> 12м04с чисто).
    bool drhook = false;
    bool gate = false;
    int ptrPatch = 0;       // 0 = никогда; -1 (auto) и 1 (always) сюда больше не приходят извне
    bool log = true;        // Logs\aw_probe.log: стартовый баннер, аудит площадок, строки skip/fault
    std::string source = "compiled-in profile";

    static const PlateSettings& load();
    std::string describe() const;
};

inline const PlateSettings& S() { return PlateSettings::load(); }
