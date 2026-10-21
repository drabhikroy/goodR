"""Builds every app icon file from the R: design.

The R is the actual DM Sans outline, converted to a path, so the icon looks
identical everywhere without depending on an installed font. Sizes of 32
pixels and below use a heavier small cut with larger dots, because thin
letterforms break down at those sizes.

Run from the repository root: python3 design/icon/build_icons.py
Requires: fonttools, brotli, cairosvg, pillow.
"""

import io
import struct
from pathlib import Path

import cairosvg
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
FONT = ROOT / "node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-opsz-normal.woff2"
OUT_ICONS = ROOT / "src-tauri/icons"
OUT_DOCS = ROOT / "docs/images"

TILE = "#1C2A36"
LETTER = "#FFFFFF"
DOTS = "#E8894D"
# The transparent variant needs darker dots on light grounds and lighter
# ones on dark grounds to keep 3 to 1 contrast against each.
DOTS_ON_LIGHT = "#B4531A"
DOTS_ON_DARK = "#F0A06A"


def glyph_path(weight, optical_size):
    font = TTFont(FONT)
    fixed = instancer.instantiateVariableFont(font, {"wght": weight, "opsz": optical_size})
    glyphs = fixed.getGlyphSet()
    pen = SVGPathPen(glyphs)
    glyphs[fixed.getBestCmap()[ord("R")]].draw(pen)
    return pen.getCommands()


STANDARD_R = glyph_path(700, 32)
SMALL_R = glyph_path(900, 9)


def mark(unit, cut, letter=LETTER, dots=DOTS):
    """The R and colon in a 100 unit square, scaled by `unit`.

    Font outlines have y pointing up, so the glyph is flipped. The numbers
    match the design canvas: baseline, size, and dot centers.
    """
    if cut == "small":
        path, x, baseline, size, dot_x, dot_y, radius = SMALL_R, 9, 80, 80, 80, (40, 70), 10
    else:
        path, x, baseline, size, dot_x, dot_y, radius = STANDARD_R, 17, 74, 66, 77, (42, 66), 7.5
    scale = size / 1000 * unit
    return (
        f"<path transform=\"translate({x * unit:.2f} {baseline * unit:.2f}) scale({scale:.5f} {-scale:.5f})\" "
        f"d=\"{path}\" fill=\"{letter}\"/>"
        + dot(dot_x * unit, dot_y[0] * unit, radius * unit, dots)
        + dot(dot_x * unit, dot_y[1] * unit, radius * unit, dots)
    )


def dot(x, y, radius, fill):
    """One dot of the colon."""
    return f"<circle cx=\"{x:.2f}\" cy=\"{y:.2f}\" r=\"{radius:.2f}\" fill=\"{fill}\"/>"


def app_icon_svg(cut):
    """A 1024 square in the macOS icon grid: an 824 tile with a soft shadow."""
    unit = 8.24
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">'
        '<defs><filter id="shadow" x="-10%" y="-10%" width="120%" height="125%">'
        '<feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#000" flood-opacity="0.28"/></filter></defs>'
        f'<rect x="100" y="100" width="824" height="824" rx="185" fill="{TILE}" filter="url(#shadow)"/>'
        f'<g transform="translate(100 100)">{mark(unit, cut)}</g></svg>'
    )


def tile_svg(cut, size):
    """A full bleed rounded tile, used for Windows and Linux icons."""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 100 100">'
        f'<rect width="100" height="100" rx="22" fill="{TILE}"/>{mark(1, cut)}</svg>'
    )


def png(svg, size):
    # cairosvg renders at the requested pixel size directly, which is what
    # the per size legibility check needs. Scaling one large render down
    # would blur the small sizes.
    return cairosvg.svg2png(bytestring=svg.encode(), output_width=size, output_height=size)


def write_icns(path, entries):
    """Writes an Apple icon file from (type code, PNG bytes) pairs."""
    chunks = b"".join(code.encode() + struct.pack(">I", len(data) + 8) + data for code, data in entries)
    path.write_bytes(b"icns" + struct.pack(">I", len(chunks) + 8) + chunks)


def write_ico(path, images):
    """Writes a Windows icon file holding one PNG per size."""
    header = struct.pack("<HHH", 0, 1, len(images))
    offset = 6 + 16 * len(images)
    directory, payload = b"", b""
    for size, data in images:
        side = 0 if size >= 256 else size
        directory += struct.pack("<BBBBHHII", side, side, 0, 0, 1, 32, len(data), offset + len(payload))
        payload += data
    path.write_bytes(header + directory + payload)


def portfolio_variants():
    """The three SVG variants every portfolio app ships, in a 32 unit box."""
    unit = 0.32
    small = mark(unit, "small")
    dark_tile = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="R: app icon">'
        f'<rect width="32" height="32" rx="7" fill="{TILE}"/>{small}</svg>'
    )
    transparent = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="R: app icon">'
        "<style>.letter{fill:" + TILE + "}.dots{fill:" + DOTS_ON_LIGHT + "}"
        "@media (prefers-color-scheme: dark){.letter{fill:#F3EFE8}.dots{fill:" + DOTS_ON_DARK + "}}</style>"
        + mark(unit, "small", letter="LETTER", dots="DOTS").replace('fill="LETTER"', 'class="letter"').replace('fill="DOTS"', 'class="dots"')
        + "</svg>"
    )
    mono = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="R: app icon">'
        + mark(unit, "small", letter="currentColor", dots="currentColor") + "</svg>"
    )
    return {"icon-dark-tile.svg": dark_tile, "icon-transparent.svg": transparent, "icon-monochrome.svg": mono}


def main():
    OUT_ICONS.mkdir(parents=True, exist_ok=True)
    OUT_DOCS.mkdir(parents=True, exist_ok=True)
    standard, small = app_icon_svg("standard"), app_icon_svg("small")
    (ROOT / "design/icon/app-icon.svg").write_text(standard)

    # macOS: the small cut for 16 and 32 point entries, standard above.
    write_icns(OUT_ICONS / "icon.icns", [
        ("icp4", png(small, 16)), ("icp5", png(small, 32)), ("ic11", png(small, 32)),
        ("icp6", png(standard, 64)), ("ic12", png(standard, 64)),
        ("ic07", png(standard, 128)), ("ic13", png(standard, 256)), ("ic08", png(standard, 256)),
        ("ic14", png(standard, 512)), ("ic09", png(standard, 512)), ("ic10", png(standard, 1024)),
    ])
    write_ico(OUT_ICONS / "icon.ico", [
        (16, png(tile_svg("small", 16), 16)), (24, png(tile_svg("small", 24), 24)),
        (32, png(tile_svg("small", 32), 32)), (48, png(tile_svg("standard", 48), 48)),
        (64, png(tile_svg("standard", 64), 64)), (256, png(tile_svg("standard", 256), 256)),
    ])
    for name, size, cut in [("32x32.png", 32, "small"), ("64x64.png", 64, "standard"), ("128x128.png", 128, "standard"),
                            ("128x128@2x.png", 256, "standard"), ("icon.png", 512, "standard")]:
        (OUT_ICONS / name).write_bytes(png(tile_svg(cut, size), size))
    for name, svg in portfolio_variants().items():
        (OUT_DOCS / name).write_text(svg)
    (ROOT / "public").mkdir(exist_ok=True)
    (ROOT / "public/icon.svg").write_text(tile_svg("standard", 128))

    # A contact sheet at every size, for checking legibility by eye.
    sizes = [16, 24, 32, 48, 64, 128]
    sheet = Image.new("RGBA", (sum(sizes) + 20 * (len(sizes) + 1), 300), "#F6F4F0")
    x = 20
    for size in sizes:
        cut = "small" if size <= 32 else "standard"
        for row, ground in enumerate(["#F6F4F0", "#23221F"]):
            Image.new("RGBA", (size + 16, size + 16), ground)
            image = Image.open(io.BytesIO(png(tile_svg(cut, size), size)))
            backdrop = Image.new("RGBA", (size + 16, size + 16), ground)
            backdrop.alpha_composite(image, (8, 8))
            sheet.alpha_composite(backdrop, (x - 8, 20 + row * 150))
        x += size + 20
    sheet.save(ROOT / "design/icon/contact-sheet.png")
    print("Icons written to", OUT_ICONS)


if __name__ == "__main__":
    main()
