Liberation Sans Regular 2.1.5 web asset

Source: the official upstream release-linked archive identified in source-manifest.json.
The TTF and LICENSE were extracted without modification.

Rebuild (Node v25.9.0 / Brotli 1.2.0 used for the recorded output):
  node build-woff2.mjs LiberationSans-Regular.ttf LiberationSans-Regular.woff2

The builder verifies the exact input TTF SHA-256, then wraps the original raw
SFNT tables in WOFF2 using only null transforms and Brotli compression. It does
not modify names, metadata, timestamps, outlines, hinting, metrics, or coverage.
The 19 table payloads were independently decoded using fontTools 4.62.1 and
compared byte-for-byte with the original TTF; see roundtrip-verification.json.
Two runs produced the same WOFF2 SHA-256.

OFL FAQ 2.2.1 permits retaining reserved font names for a WOFF/WOFF2 version
when original font data is unchanged except compression and extended metadata
is omitted or complete: https://openfontlicense.org/ofl-faq/
Here the extended metadata and private data blocks are absent.

Integration: replace only the served Excalidraw LiberationSans-Regular.woff2
asset, retain its URL/FontFace family mapping, and include OFL.txt. Preserve
this manifest and build script. Source TTF may be kept for reproducibility;
its redistribution is under the included OFL.

Compatibility: all vertical metrics and 95 printable ASCII advance widths
match the old font. U+00B7 and U+2012 advance widths differ. U+2011 and three
private-use glyphs (F001/F002/F005) are absent; 1669 codepoints are added.
The replacement is not pixel-identical; outlines, hinting and kerning can
change rendering. Isolated HeadlessChrome 152 validated FontFace loading,
canvas drawing and embedded-font SVG decoding/drawing of the recorded bytes;
see source-manifest.json. Recheck this behavior when changing the asset.
