# Source and content provenance

The project source and original interview content use the GNU AGPL v3 license in
`LICENSE`. Package dependencies retain their respective licenses.

Browser dependency and vendored editor/font license text is published at
`/third-party-notices.txt`, generated in `web/public/third-party-notices.txt` by
`web/scripts/generate-notices.mjs`. The existing asset-copy step regenerates it
before development and production builds. It covers the installed production
npm lockfile graph, including nested compiled notices, Monaco's third-party
notices, and Excalidraw's embedded notices. This conservative inventory also
lists build/server packages that the static deployment does not ship.

Missing npm license files are supplemented only with preserved upstream texts
and recorded provenance/hashes in `web/licenses/`. The generated review list
explicitly identifies any remaining declared-license-only packages; an SPDX
label is not manufactured into a copyright notice. See `web/licenses/README.md`
for regeneration, validation, and known limitations. Dependency notices are
not a license-compatibility opinion. Go dependency redistribution remains a
separate check for anyone distributing API binaries or containers.

The original interviewer portraits are documented in
`web/components/studio/ARTWORK.md`. Do not reintroduce third-party avatar assets
without a recorded source, license and redistribution rights.

New versioned scenarios record authorship and licensing in `provenance`.
AI-assisted examples are explicitly marked as drafts pending practitioner review.
Older corpus entries have no verified authorship record and are labelled preview;
their historical provenance still requires maintainer review. No employer has
endorsed the interview packs, and company names do not imply affiliation.

The Code of Conduct adapts Contributor Covenant 2.1, with attribution in
`CODE_OF_CONDUCT.md`. Report suspected ownership or attribution errors to the
maintainer privately using [SUPPORT.md](SUPPORT.md), omitting credentials and unnecessary personal information. A public issue is optional for non-sensitive corrections.
