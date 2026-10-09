#include "BugFixes.h"
#include "GameClient.h"
#include "Hooks.h"
#include "Settings.h"
#include "Probe.h"
#include <Windows.h>
#include <Detours/detours.h>
#include <cstring>

// Клиент 3.3.5a забирает из буфера обмена и кладёт в него текст в своей однобайтовой кодировке, поэтому
// русская строка из чата вставленная в блокнот (и наоборот) превращается в кракозябры. Форк awesome
// подменяет две функции клиента на UTF-8-корректные. Перенесено без изменений по механизму, потому что
// это ровно тот профиль правок, который у нас уже измерен как безопасный: два detour'а в коде клиента и
// НИ ОДНОГО указателя на нашу dll в данных клиента -- возвращаемый строке буфер берётся у самого клиента.

namespace {

using ClientAlloc_t = void* (*)(size_t);
const DWORD CLIENT_ALLOC_ADDR = 0x00415074;
// Адрес аллокатора клиента проверяется при установке, как и площадки хуков, и до проверки здесь NULL. Это
// такой же жёстко прописанный адрес сборки 12340: если по нему не исполняемый код, вызов -- это передача
// управления в произвольное место, а не «аллокация не удалась».
ClientAlloc_t g_clientAlloc = NULL;

// Пустая строка должна быть буфером КЛИЕНТА, а не нашей константой. Прежний `return ""` отдавал наружу
// указатель в .rdata этой dll: во-первых, правило проекта -- в данных клиента не остаётся ни одного
// указателя на нашу dll; во-вторых, получатель вправе освободить выданный буфер своим аллокатором, а
// освобождение константы из чужого образа -- это падение в куче клиента.
const char* clientEmptyString()
{
    if (g_clientAlloc) {
        if (char* p = (char*)g_clientAlloc(1)) { p[0] = '\0'; return p; }
    }
    // Аллокатор клиента отказал (памяти нет). NULL вернуть нельзя -- вызывающий код в Lua печатает результат
    // без проверки, так что из двух плохих вариантов берём тот, который хотя бы не читает по нулю.
    return "";
}

using ClipboardGetString_t = const char* (__cdecl*)(HWND);
ClipboardGetString_t Clipboard_GetString_orig;

using ClipboardSetString_t = int(__cdecl*)(const char*, HWND);
ClipboardSetString_t Clipboard_SetString_orig;

// Пустая строка отдаётся буфером клиента, а не нулём: вызывающий код в Lua печатает результат без
// проверки на NULL.
const char* __cdecl Clipboard_GetString_hk(HWND hwnd)
{
    if (!OpenClipboard(hwnd)) return clientEmptyString();
    HANDLE hMem = GetClipboardData(CF_UNICODETEXT);
    if (!hMem) { CloseClipboard(); return clientEmptyString(); }

    const wchar_t* utf16 = (const wchar_t*)GlobalLock(hMem);
    if (!utf16) { CloseClipboard(); return clientEmptyString(); }

    const int wLen = (int)wcslen(utf16) + 1;
    // Флаги нулевые, в отличие от форка: WC_ERR_INVALID_CHARS ронял весь перевод в пустоту на одной битой
    // последовательности, а для вставки из чата важнее сохранить текст целиком.
    const int u8Len = WideCharToMultiByte(CP_UTF8, 0, utf16, wLen, NULL, 0, NULL, NULL);
    char* out = NULL;
    if (u8Len > 0 && g_clientAlloc) {
        out = (char*)g_clientAlloc(u8Len);
        // Неудача второго прохода оставляет буфер целиком не записанным, а вызывающий код в Lua печатает
        // результат как есть: без нуля на входе он читает за границей строки. Провал = отдать пустую строку.
        if (out && WideCharToMultiByte(CP_UTF8, 0, utf16, wLen, out, u8Len, NULL, NULL) == 0) out = NULL;
    }

    GlobalUnlock(hMem);
    CloseClipboard();
    return out ? out : clientEmptyString();
}

int __cdecl Clipboard_SetString_hk(const char* str, HWND hwnd)
{
    if (!str || !str[0]) {
        if (!OpenClipboard(hwnd)) return 0;
        const BOOL emptied = EmptyClipboard();
        CloseClipboard();
        return emptied ? 1 : 0;
    }

    const int u8Len = (int)strlen(str) + 1;
    const int wLen = MultiByteToWideChar(CP_UTF8, 0, str, u8Len, NULL, 0);
    if (wLen <= 0) return 0;

    HGLOBAL hMem = GlobalAlloc(GMEM_MOVEABLE, sizeof(wchar_t) * (wLen + 1));
    if (!hMem) return 0;

    wchar_t* wide = (wchar_t*)GlobalLock(hMem);
    if (!wide) { GlobalFree(hMem); return 0; }
    MultiByteToWideChar(CP_UTF8, 0, str, u8Len, wide, wLen);
    wide[wLen] = L'\0';
    GlobalUnlock(hMem);

    if (!OpenClipboard(hwnd)) { GlobalFree(hMem); return 0; }
    if (!EmptyClipboard()) { CloseClipboard(); GlobalFree(hMem); return 0; }
    // Память переходит буферу обмена только при успешном вызове; при отказе (окно занято чужим process)
    // блок остаётся нашим, и его надо освободить самому. Возврат -- тоже по факту, а не всегда единица.
    // SetClipboardData отдаёт HANDLE (указатель), а не BOOL: сверяться надо с NULL.
    const HANDLE stored = SetClipboardData(CF_UNICODETEXT, hMem);
    if (!stored) GlobalFree(hMem);
    CloseClipboard();
    return stored ? 1 : 0;
}

}

void BugFixes::initialize()
{
    if (!S().clipboard) return;
    // Проверка до attach: DetourAttach читает байты площадки, а чтение битого адреса внутри транзакции
    // роняет её целиком -- вместе со всеми фичами, которые в ней лежат.
    if (!Hooks::isImageCode(0x008726F0) || !Hooks::isImageCode(0x008727E0)) {
        Probe::log("clipboard: sites are not executable client code (get=%d set=%d), feature skipped",
            (int)Hooks::isImageCode(0x008726F0), (int)Hooks::isImageCode(0x008727E0));
        return;
    }
    // Аллокатор клиента проверяется так же, как площадки: без него перехват чтения буфера обмена всё равно
    // не может вернуть строку, а вызов по непроверенному адресу -- это прыжок в произвольное место.
    if (!Hooks::isImageCode(CLIENT_ALLOC_ADDR)) {
        Probe::log("clipboard: аллокатор клиента %08X не исполняемый код -- фича пропущена", CLIENT_ALLOC_ADDR);
        return;
    }
    g_clientAlloc = (ClientAlloc_t)CLIENT_ALLOC_ADDR;
    // Адреса берём в момент установки, а не при инициализации глобалов: иначе отсутствующий ключ конфа
    // всё равно оставил бы в данных dll указатели на чужие функции.
    Clipboard_GetString_orig = (ClipboardGetString_t)0x008726F0;
    Clipboard_SetString_orig = (ClipboardSetString_t)0x008727E0;
    DetourAttach(&(LPVOID&)Clipboard_GetString_orig, (LPVOID)&Clipboard_GetString_hk);
    DetourAttach(&(LPVOID&)Clipboard_SetString_orig, (LPVOID)&Clipboard_SetString_hk);
}

void BugFixes::auditSites()
{
    if (!S().clipboard) return;
    Probe::auditSite("ClipboardGetString", (void*)0x008726F0);
    Probe::auditSite("ClipboardSetString", (void*)0x008727E0);
}
