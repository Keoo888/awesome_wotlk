#pragma once
#include <Windows.h>
#include <charconv>
#include <cstring>
#include <fstream>
#include <streambuf>
#include <vector>

bool readFile(const char* path, std::vector<char>& content)
{
    std::ifstream file(path, std::ios::binary);
    if (!file) return false;
    content.assign(std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>());
    return !content.empty();
}

bool writeFile(const char* path, const std::vector<char>& content)
{
    std::ofstream file(path, std::ios::binary | std::ios::trunc);
    if (!file) return false;
    file.write(content.data(), content.size());
    file.flush();
    // Открыть файл на запись и не дописать его до конца -- это испорченный Wow.exe, а не успех: поток
    // открывается с trunc, то есть старое содержимое уже уничтожено к этому моменту.
    return file.good();
}

// Заголовки PE проверяются по полям, а не принимаются на веру. Файл сюда приходит от игрока (в том числе
// перетаскиванием мышью), а дальше по числам из этих заголовков считается смещение, по которому мы ПИШЕМ:
// любая невалидная структура без проверки -- это запись в произвольное место чужого файла.
const IMAGE_NT_HEADERS* peHeaders(const std::vector<char>& image)
{
    if (image.size() < sizeof(IMAGE_DOS_HEADER)) return NULL;
    const IMAGE_DOS_HEADER* dos = (const IMAGE_DOS_HEADER*)image.data();
    if (dos->e_magic != IMAGE_DOS_SIGNATURE) return NULL;
    if (dos->e_lfanew < 0) return NULL;
    if ((size_t)dos->e_lfanew + sizeof(IMAGE_NT_HEADERS) > image.size()) return NULL;
    const IMAGE_NT_HEADERS* nt = (const IMAGE_NT_HEADERS*)(image.data() + dos->e_lfanew);
    if (nt->Signature != IMAGE_NT_SIGNATURE) return NULL;
    // Клиент 3.3.5a -- 32-битный x86, и адреса патчей абсолютные. 64-битный или ARM-образ здесь означает,
    // что игрок указал не тот файл.
    if (nt->FileHeader.Machine != IMAGE_FILE_MACHINE_I386) return NULL;
    if (nt->OptionalHeader.Magic != IMAGE_NT_OPTIONAL_HDR32_MAGIC) return NULL;
    const size_t sectionsAt = (size_t)dos->e_lfanew + FIELD_OFFSET(IMAGE_NT_HEADERS, OptionalHeader)
        + nt->FileHeader.SizeOfOptionalHeader;
    if (sectionsAt + (size_t)nt->FileHeader.NumberOfSections * sizeof(IMAGE_SECTION_HEADER) > image.size())
        return NULL;
    return nt;
}

// Смещение в файле для виртуального адреса, или 0, если адрес не лежит ни в одной секции.
// Размер отображения берётся по минимуму из VirtualSize и SizeOfRawData: VirtualSize бывает больше
// (хвост секции в файле физически отсутствует), и адрес из такого хвоста давал бы смещение за концом файла.
unsigned virtualAddress2RawOffset(const std::vector<char>& image, unsigned address)
{
    const IMAGE_NT_HEADERS* ntHeaders = peHeaders(image);
    if (!ntHeaders) return 0;

    const IMAGE_SECTION_HEADER* header = IMAGE_FIRST_SECTION(ntHeaders);
    for (size_t i = 0; i < ntHeaders->FileHeader.NumberOfSections; i++, header++) {
        if (!header->SizeOfRawData) continue;
        DWORD size = header->Misc.VirtualSize;
        if (!size || size > header->SizeOfRawData) size = header->SizeOfRawData;
        DWORD begin = ntHeaders->OptionalHeader.ImageBase + header->VirtualAddress;
        DWORD end = begin + size;
        if (address >= begin && address < end)
            return address - begin + header->PointerToRawData;
    }

    return 0;
}

// Строки патчей -- константы из Patch.h, но ошибка в них не должна превращаться в «записали половину»:
// раньше неразобранная пара просто пропускалась, и байты съезжали. Теперь нечётная длина или любая
// не-hex пара -- отказ целиком.
bool convHexString2ByteArray(const char* hex, std::vector<char>& result)
{
    result.clear();
    if (!hex) return false;
    const size_t hexLen = strlen(hex);
    if (hexLen == 0 || (hexLen % 2) != 0) return false;
    result.reserve(hexLen / 2);
    for (size_t i = 0; i < hexLen; i += 2) {
        unsigned v = 0;
        const auto parsed = std::from_chars(&hex[i], &hex[i + 2], v, 0x10);
        if (parsed.ec != std::errc{} || parsed.ptr != &hex[i + 2]) return false;
        result.push_back((char)(v & 0xFF));
    }
    return true;
}
