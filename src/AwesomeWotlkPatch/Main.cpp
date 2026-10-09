#include "Utils.h"
#include "Patch.h"
#include <Windows.h>
#include <cstring>
#include <filesystem>
#include <format>
#include <string>
#include <vector>
#define AWESOMEWOTLKLIB_DLL "AwesomeWotlkLib.dll"

static std::string s_appName;

// Единственная проверка «тот ли это клиент»: TimeDateStamp из заголовка 3.3.5a (12340), снятый с рабочих
// копий Wow.exe. Адреса в Patch.h абсолютные и принадлежат именно этой сборке, на другой они указывают в
// произвольный код. Это вопрос игроку, а не запрет: клиент может называться иначе и быть пересобран.
static const DWORD WOW_335A_TIMEDATESTAMP = 0x4C2452FE;

// Файл клиента ищем рядом с самим патчером, а не в текущем каталоге процесса: при запуске с ярлыка или из
// другого места CWD -- это не папка игры, и патчер отвечал «Wow.exe не найден», лежа прямо рядом с ним.
std::string findGameClientExecutable(const std::filesystem::path& dir)
{
    static const char* possibleNames[] = { "Wow.exe", "WowCircle.exe", "run.exe" };
    for (const char* name : possibleNames) {
        std::error_code ec;
        std::filesystem::path candidate = dir / name;
        if (std::filesystem::is_regular_file(candidate, ec))
            return candidate.string();
    }
    return std::string();
}

enum class PatchResult { Failed, Applied, AlreadyPatched };

PatchResult applyPatches(const char* path)
{
    std::vector<char> image;
    if (!readFile(path, image)) return PatchResult::Failed;

    // Сначала считаем ВСЕ записи и проверяем их, и только потом трогаем файл: иначе отказ на третьей
    // площадке оставлял бы exe с двумя применёнными правками из трёх.
    struct Write { unsigned offset; std::vector<char> data; };
    std::vector<Write> writes;
    bool allPresent = true;

    for (auto& [virtualAddress, hexBytes] : s_patches) {
        unsigned offset = virtualAddress2RawOffset(image, virtualAddress);
        if (!offset) {
            SetLastError(ERROR_INVALID_ADDRESS);
            return PatchResult::Failed;
        }
        std::vector<char> data;
        if (!convHexString2ByteArray(hexBytes, data) || data.empty()) {
            SetLastError(ERROR_BAD_ARGUMENTS);
            return PatchResult::Failed;
        }
        // Границы: смещение посчитано по заголовку файла, а пишем мы в буфер этого же файла. Без проверки
        // обрезанный или просто другой exe давал бы запись за концом буфера.
        if ((size_t)offset + data.size() > image.size()) {
            SetLastError(ERROR_INVALID_ADDRESS);
            return PatchResult::Failed;
        }
        if (memcmp(&image[offset], data.data(), data.size()) != 0) allPresent = false;
        writes.push_back({ offset, std::move(data) });
    }

    // Уже пропатчен -- файл не перезаписываем вообще. Повторный запуск патчера на готовом клиенте это
    // штатная ситуация (игрок не помнит, запускал ли), и она не должна ни трогать exe, ни делать .bak.
    if (allPresent) return PatchResult::AlreadyPatched;

    // Копия ДО первой записи: если запись не доживёт до конца (диск, права, антивирус), у игрока должен
    // остаться рабочий клиент, а не половина файла. Существующий .bak не перезаписывается -- он старше и,
    // значит, ближе к стоковому.
    std::error_code ec;
    std::filesystem::path backup = path;
    backup += ".bak";
    if (!std::filesystem::exists(backup, ec)) {
        std::filesystem::copy_file(path, backup, ec);
        if (ec) {
            SetLastError(ec.value() ? (DWORD)ec.value() : ERROR_WRITE_FAULT);
            return PatchResult::Failed;
        }
    }

    for (auto& write : writes)
        memcpy(&image[write.offset], write.data.data(), write.data.size());
    if (!writeFile(path, image)) return PatchResult::Failed;
    return PatchResult::Applied;
}

template<typename... Args>
void message(DWORD icon, const char* fmt, Args&&... args)
{
    MessageBoxA(NULL, std::vformat(fmt, std::make_format_args(std::forward<Args>(args)...)).c_str(), s_appName.c_str(), icon | MB_OK);
}

template<typename... Args>
bool question(const char* fmt, Args&&... args)
{
    return MessageBoxA(NULL, std::vformat(fmt, std::make_format_args(std::forward<Args>(args)...)).c_str(),
        s_appName.c_str(), MB_ICONWARNING | MB_YESNO) == IDYES;
}

// Правки привязаны к одной сборке клиента. Если заголовок говорит о другой, спрашиваем прямо: применить
// такие адреса к другому билду -- значит испортить exe, и об этом игрок должен узнать до записи, а не после.
bool buildLooksRight(const char* path)
{
    std::vector<char> image;
    if (!readFile(path, image)) {
        message(MB_ICONERROR, "Can't read {}", path);
        return false;
    }
    const IMAGE_NT_HEADERS* nt = peHeaders(image);
    if (!nt) {
        message(MB_ICONERROR, "{}\nis not a 32-bit Windows executable", path);
        return false;
    }
    const DWORD stamp = nt->FileHeader.TimeDateStamp;
    const DWORD expected = WOW_335A_TIMEDATESTAMP;
    if (stamp == expected) return true;
    return question(
        "{}\ndoes not look like the 3.3.5a (12340) client.\n"
        "Header stamp is {:08X}, expected {:08X}.\n\n"
        "The patch addresses are fixed and belong to that build; applying\n"
        "them to another build will corrupt the executable.\n\n"
        "Apply anyway?",
        path, stamp, expected);
}

int main(int argc, char** argv)
{
    s_appName = std::filesystem::path(argv[0]).filename().string();

    std::string exePath;
    if (argc > 1)
        exePath = argv[1];
    else
        exePath = findGameClientExecutable(std::filesystem::absolute(argv[0]).parent_path());

    if (exePath.empty()) {
        message(MB_ICONERROR,
            "World of Warcraft executable not found!\n"
            "You must do one of this action:\n"
            "- Move patcher to folder with Wow.exe\n"
            "- Drag and drop Wow.exe into {}\n"
            "- Use command line interface `{} <path>`",
            s_appName, s_appName);
        return 1;
    }

    if (!buildLooksRight(exePath.c_str()))
        return 1;

    const PatchResult result = applyPatches(exePath.c_str());
    if (result == PatchResult::Failed) {
        DWORD lastError = GetLastError();
        char* msg = NULL;
        FormatMessageA(FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS, NULL, lastError, MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT), (LPSTR)&msg, 0, NULL);
        // "Error code {}" стояло здесь после запятой, то есть уходило не в формат, а в аргументы: номер
        // ошибки в окне не появлялся вообще. И буфер FormatMessage надо освобождать -- он из LocalAlloc.
        const char* reason = msg ? msg : "";
        message(MB_ICONERROR,
            "Can't apply patch to {}\n"
            "{}"
            "Error code {}",
            exePath, reason, lastError);
        if (msg) LocalFree(msg);
        return 1;
    }

    std::filesystem::path libInGamePath = std::filesystem::path(exePath).parent_path() / AWESOMEWOTLKLIB_DLL;
    std::filesystem::path libInAppPath = std::filesystem::absolute(argv[0]).parent_path() / AWESOMEWOTLKLIB_DLL;
    if (!std::filesystem::is_regular_file(libInGamePath) && std::filesystem::is_regular_file(libInAppPath)) {
        std::error_code ec;
        std::filesystem::copy_file(libInAppPath, libInGamePath, ec);
    }

    const char* headline = (result == PatchResult::AlreadyPatched)
        ? "Patch is already applied" : "Patch succesfully applied";

    if (std::filesystem::is_regular_file(libInGamePath)) {
        message(MB_ICONINFORMATION,
            "{}\n"
            "Now you can enter the game",
            headline
        );
    } else {
        message(MB_ICONWARNING,
            "{}\n"
            "But look like `" AWESOMEWOTLKLIB_DLL "` is missed\n"
            "Before entering game you must place it to game folder",
            headline
        );
    }

    return 0;
}
