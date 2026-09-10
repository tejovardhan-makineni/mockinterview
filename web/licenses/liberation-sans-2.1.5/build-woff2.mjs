// Lossless WOFF2 wrapping of the unmodified official Liberation Sans 2.1.5 TTF.
// No subsetting, glyph transformations, renaming, timestamps or metadata edits.
// WOFF2 null transforms preserve every original SFNT table byte for byte.
// Usage: node build-woff2.mjs INPUT.ttf OUTPUT.woff2
import { readFileSync, writeFileSync } from 'node:fs';
import { brotliCompressSync, constants } from 'node:zlib';
import { createHash } from 'node:crypto';
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node build-woff2.mjs INPUT.ttf OUTPUT.woff2');
const source = readFileSync(input);
const expected = '76d04c18ea243f426b7de1f3ad208e927008f961dc5945e5aad352d0dfde8ee8';
const digest = createHash('sha256').update(source).digest('hex');
if (digest !== expected) throw new Error(`Unexpected source TTF SHA-256: ${digest}`);
const tags = ['cmap','head','hhea','hmtx','maxp','name','OS/2','post','cvt ','fpgm','glyf','loca','prep','CFF ','VORG','EBDT','EBLC','gasp','hdmx','kern','LTSH','PCLT','VDMX','vhea','vmtx','BASE','GDEF','GPOS','GSUB','EBSC','JSTF','MATH','CBDT','CBLC','COLR','CPAL','SVG ','sbix','acnt','avar','bdat','bloc','bsln','cvar','fdsc','feat','fmtx','fvar','gvar','hsty','just','lcar','mort','morx','opbd','prop','trak','Zapf','Silf','Glat','Gloc','Feat','Sill'];
function uintBase128(value) {
  const bytes = [value & 0x7f];
  while ((value = Math.floor(value / 128))) bytes.unshift((value & 0x7f) | 0x80);
  return Buffer.from(bytes);
}
const count = source.readUInt16BE(4);
const tables = Array.from({length: count}, (_, i) => {
  const offset = 12 + i * 16;
  const tag = source.toString('ascii', offset, offset + 4);
  const start = source.readUInt32BE(offset + 8);
  const length = source.readUInt32BE(offset + 12);
  if (start + length > source.length) throw new Error(`Invalid table ${tag}`);
  return {tag, data: source.subarray(start, start + length)};
}).sort((a,b) => a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0);
const directory = Buffer.concat(tables.map(({tag,data}) => {
  const index = tags.indexOf(tag);
  // glyf and loca use transform version 3 for the null transform; all others use 0.
  const flags = (index < 0 ? 63 : index) | (tag === 'glyf' || tag === 'loca' ? 0xc0 : 0);
  return Buffer.concat([Buffer.from([flags]), ...(index < 0 ? [Buffer.from(tag,'ascii')] : []), uintBase128(data.length)]);
}));
const compressed = brotliCompressSync(Buffer.concat(tables.map(t => t.data)), {
  params: {
    [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_FONT,
    [constants.BROTLI_PARAM_QUALITY]: 11,
    [constants.BROTLI_PARAM_LGWIN]: 22,
  },
});
const unpaddedLength = 48 + directory.length + compressed.length;
// WOFF2 compressed data ends on a 4-byte boundary, including terminal padding.
const length = Math.ceil(unpaddedLength / 4) * 4;
const header = Buffer.alloc(48);
header.write('wOF2',0,'ascii');
source.copy(header,4,0,4);
header.writeUInt32BE(length,8);
header.writeUInt16BE(count,12);
const sfntSize = 12 + 16 * count + tables.reduce((total,t) => total + Math.ceil(t.data.length / 4) * 4,0);
header.writeUInt32BE(sfntSize,16);
header.writeUInt32BE(compressed.length,20);
const head = tables.find(t => t.tag === 'head').data;
head.copy(header,24,4,8); // Version only; WOFF-specific metadata/private blocks are absent.
const result = Buffer.concat([header,directory,compressed,Buffer.alloc(length - unpaddedLength)]);
writeFileSync(output,result);
console.log(JSON.stringify({sourceSha256:digest,outputSha256:createHash('sha256').update(result).digest('hex'),bytes:result.length,tables:count,node:process.version,brotli:process.versions.brotli}));
