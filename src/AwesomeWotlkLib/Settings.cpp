#include "Settings.h"
#include <cstdio>

// Профиль не читается извне: см. комментарий в Settings.h. Функция оставлена в той же форме, что и была,
// чтобы все места S().<ключ> не менялись, -- и чтобы вызов S() оставался дешёвым (один статик).
const PlateSettings& PlateSettings::load() {
    static PlateSettings settings;
    return settings;
}

std::string PlateSettings::describe() const {
    char buf[224];
    snprintf(buf, sizeof(buf), "scope=%d sort=%d token=%d drhook=%d tokensite=%d gate=%d ptrpatch=%d log=%d camera=%d macros=%d clipboard=%d namegate=%d fade=%d interact=%d distance=%d  source=",
        scope, (int)sort, (int)tokenResolve, (int)drhook, tokenSite, (int)gate, ptrPatch, (int)log,
        (int)camera, (int)macros, (int)clipboard, (int)namegate, (int)fade, (int)interact, (int)distance);
    return std::string(buf) + source;
}
