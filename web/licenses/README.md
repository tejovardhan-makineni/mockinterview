# Browser dependency and font notices

`../public/third-party-notices.txt` is generated from the installed non-dev
entries of `package-lock.json`. It preserves discovered LICENSE, NOTICE, OFL,
COPYING and bundled license files, including Next's compiled components and
Monaco's `ThirdPartyNotices.txt`. Excalidraw embeds some component notices in
JavaScript comments, so those comments are preserved too. The inventory is
broader than the static browser bundle; native build and server dependencies
listed here are not thereby claimed to be redistributed by Firebase hosting.

The npm Excalidraw tarball omits its root license and font license files.
`manifest.json` records exact package versions, upstream sources, text hashes
and provenance for checked-in supplements. Do not replace an attribution with
a generic SPDX template or guess a copyright holder. The Radix legacy packages
with no published gitHead were checked against every package source file in
their installed source maps and the matching upstream commit.

The browser copy replaces Excalidraw's old GPL Liberation 1.05 font with the
official OFL Liberation Sans 2.1.5 release, preserving numeric family 9 and the
asset URL. `liberation-sans-2.1.5/` contains the original TTF/license, an offline
Node build script, hashes and byte-level roundtrip evidence. The conversion
retains every original font table, including copyright and names. All printable
ASCII advances and vertical metrics match the old font; some non-ASCII glyphs,
outlines and kerning differ. See its source manifest for the exact differences.
The old GPL font is not copied into the static release.

After `npm ci`, run from `web/`:

```sh
node scripts/generate-notices.mjs
node --test scripts/generate-notices.test.mjs
node scripts/generate-notices.mjs --check
```

The existing `prebuild` and `predev` asset-copy hooks regenerate the file without
network access. Output is deterministic for an identical installed lock graph;
OS-specific optional build packages can differ between platforms. The generator
fails on missing required packages, version drift or changed supplement hashes.
Missing full license texts are prominently flagged in the output and stderr;
`--strict` additionally treats those unresolved texts as an error. Supplements
apply only to their recorded package versions, so upgrades require review.

This file does not certify license compatibility or replace source-distribution
obligations. Review the generated warning list before distributing dependencies
in a form different from this static application. In particular, native libvips
is a build/server dependency with separate source and component obligations;
the static site does not ship that native library. Review API/Go binary notices
separately if distributing the API container or a standalone executable.
