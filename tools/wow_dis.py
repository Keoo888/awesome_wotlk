"""Linear disassembly of the 3.3.5a client image straight out of Wow.exe.

    python tools/dis.py 0x0060ABF0 0x70

Maps VA -> file offset through the real PE section table, prints one instruction per line and
annotates any immediate that points at a printable string in the image. Read-only helper for
choosing hook sites; nothing here is used by the dll.
"""
import sys
import struct

import capstone

EXE = sys.argv[3] if len(sys.argv) > 3 else r"D:\Games\WowAwesome\WoW.exe"

with open(EXE, "rb") as f:
    IMAGE = f.read()

pe = struct.unpack_from("<I", IMAGE, 0x3C)[0]
nsec = struct.unpack_from("<H", IMAGE, pe + 6)[0]
sizeofopt = struct.unpack_from("<H", IMAGE, pe + 20)[0]
IMAGE_BASE = struct.unpack_from("<I", IMAGE, pe + 24 + 28)[0]

SECTIONS = []
off = pe + 24 + sizeofopt
for i in range(nsec):
    name = IMAGE[off:off + 8].rstrip(b"\0").decode("ascii", "replace")
    vsize, va, rawsize, raw = struct.unpack_from("<IIII", IMAGE, off + 8)
    SECTIONS.append((name, IMAGE_BASE + va, vsize, raw, rawsize))
    off += 40

for name, va, vsize, raw, rawsize in SECTIONS:
    print("  section %-8s va=0x%08X vsize=0x%X raw=0x%X rawsize=0x%X" % (name, va, vsize, raw, rawsize), file=sys.stderr)


def va2off(va):
    for _, sva, svsize, sraw, srawsize in SECTIONS:
        if sva <= va < sva + max(svsize, srawsize):
            delta = va - sva
            if delta < srawsize:
                return sraw + delta
    return None


def read_cstr(va, limit=64):
    o = va2off(va)
    if o is None:
        return None
    end = IMAGE.find(b"\0", o, o + limit)
    if end < 0:
        return None
    raw = IMAGE[o:end]
    if not raw or any(c < 0x20 or c > 0x7E for c in raw):
        return None
    return raw.decode("ascii")


def annotate(va):
    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_32)
    md.detail = True
    o = va2off(va)
    if o is None:
        print("0x%08X: not mapped in file" % va)
        return
    count = int(sys.argv[2], 0) if len(sys.argv) > 2 else 0x40
    for ins in md.disasm(IMAGE[o:o + count * 16], va):
        note = ""
        for grp in ("imm", ):
            pass
        for op in ins.operands:
            if op.type == capstone.x86.X86_OP_IMM:
                s = read_cstr(op.imm & 0xFFFFFFFF)
                if s:
                    note = "   ; -> 0x%X \"%s\"" % (op.imm & 0xFFFFFFFF, s)
                elif va2off(op.imm & 0xFFFFFFFF) is not None:
                    note = "   ; -> 0x%X" % (op.imm & 0xFFFFFFFF)
        print("0x%08X  %-24s %s %s%s" % (ins.address, ins.bytes.hex(" "), ins.mnemonic, ins.op_str, note))


if len(sys.argv) < 2:
    print(__doc__)
    sys.exit(1)
annotate(int(sys.argv[1], 0))
