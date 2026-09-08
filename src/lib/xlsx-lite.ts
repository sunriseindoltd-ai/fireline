/** Minimal XLSX/CSV helper — no `xlsx` package. Browser + Node 22. */

const PK = 0x04034b50;
const PK_CENTRAL = 0x02014b50;
const PK_EOCD = 0x06054b50;

function u16(b: Uint8Array, i: number) {
  return b[i]! | (b[i + 1]! << 8);
}
function u32(b: Uint8Array, i: number) {
  return (
    (b[i]! |
      (b[i + 1]! << 8) |
      (b[i + 2]! << 16) |
      (b[i + 3]! << 24)) >>>
    0
  );
}
function w16(out: Uint8Array, i: number, v: number) {
  out[i] = v & 255;
  out[i + 1] = (v >>> 8) & 255;
}
function w32(out: Uint8Array, i: number, v: number) {
  out[i] = v & 255;
  out[i + 1] = (v >>> 8) & 255;
  out[i + 2] = (v >>> 16) & 255;
  out[i + 3] = (v >>> 24) & 255;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function asBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([asBuffer(data)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function findEocd(bytes: Uint8Array) {
  const start = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= start; i--) {
    if (u32(bytes, i) === PK_EOCD) return i;
  }
  throw new Error("not a zip / xlsx");
}

async function unzip(buf: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(buf);
  if (bytes.length < 4 || u32(bytes, 0) !== PK) {
    throw new Error("not a zip / xlsx");
  }
  const eocd = findEocd(bytes);
  const entries = u16(bytes, eocd + 10);
  let offset = u32(bytes, eocd + 16);
  const files = new Map<string, Uint8Array>();
  for (let n = 0; n < entries; n++) {
    if (u32(bytes, offset) !== PK_CENTRAL) throw new Error("bad zip directory");
    const method = u16(bytes, offset + 10);
    const compSize = u32(bytes, offset + 20);
    const nameLen = u16(bytes, offset + 28);
    const extraLen = u16(bytes, offset + 30);
    const commentLen = u16(bytes, offset + 32);
    const localOff = u32(bytes, offset + 42);
    const name = new TextDecoder("utf-8").decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
    const localNameLen = u16(bytes, localOff + 26);
    const localExtra = u16(bytes, localOff + 28);
    const dataStart = localOff + 30 + localNameLen + localExtra;
    const compressed = bytes.subarray(dataStart, dataStart + compSize);
    let raw: Uint8Array;
    if (method === 0) raw = compressed.slice();
    else if (method === 8) raw = await inflateRaw(compressed);
    else throw new Error("unsupported zip compression");
    files.set(name.replace(/^\/+/, ""), raw);
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

function xmlText(bytes: Uint8Array) {
  let s = new TextDecoder("utf-8").decode(bytes);
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return s.replace(/<\/?[\w.]+:/g, (m) => m.replace(/[\w.]+:/, ""));
}

function unescapeXml(s: string) {
  const a = "\u0026";
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(new RegExp(a + "lt;", "g"), "<")
    .replace(new RegExp(a + "gt;", "g"), ">")
    .replace(new RegExp(a + "quot;", "g"), '"')
    .replace(new RegExp(a + "apos;", "g"), "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(new RegExp(a + "amp;", "g"), "&");
}

function escapeXml(s: string) {
  const a = "\u0026";
  return s
    .replace(/&/g, a + "amp;")
    .replace(/</g, a + "lt;")
    .replace(/>/g, a + "gt;")
    .replace(/"/g, a + "quot;");
}

function joinPath(fromFile: string, rel: string) {
  if (rel.startsWith("/")) return rel.replace(/^\/+/, "");
  const dir = fromFile.split("/").slice(0, -1);
  for (const p of rel.split("/")) {
    if (!p || p === ".") continue;
    if (p === "..") dir.pop();
    else dir.push(p);
  }
  return dir.join("/");
}

function colIndex(ref: string) {
  let n = 0;
  for (const ch of ref) {
    if (ch < "A" || ch > "Z") break;
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

function colLetter(i: number) {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function parseSst(xml: string): string[] {
  const out: string[] = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(xml))) {
    const parts: string[] = [];
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let t: RegExpExecArray | null;
    while ((t = tRe.exec(m[1]!))) parts.push(unescapeXml(t[1]!));
    out.push(parts.join(""));
  }
  return out;
}

function attr(tag: string, name: string) {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m?.[1] ?? "";
}

function parseSheet(xml: string, sst: string[]): string[][] {
  const rows: string[][] = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(xml))) {
    const cells: string[] = [];
    const cellRe = /<c\b([^>]*)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rm[1]!))) {
      const head = cm[1] ?? cm[2] ?? "";
      const body = cm[3] ?? "";
      const r = attr(head, "r");
      const t = attr(head, "t");
      const col = colIndex(r);
      if (col < 0) continue;
      let value = "";
      if (t === "s") {
        const v = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
        const idx = Number(v?.[1] ?? "");
        value = Number.isFinite(idx) ? (sst[idx] ?? "") : "";
      } else if (t === "inlineStr" || t === "str") {
        const parts: string[] = [];
        const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
        let tm: RegExpExecArray | null;
        while ((tm = tRe.exec(body))) parts.push(unescapeXml(tm[1]!));
        if (!parts.length) {
          const v = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
          if (v) parts.push(unescapeXml(v[1]!));
        }
        value = parts.join("");
      } else if (t === "b") {
        const v = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
        value = v?.[1] === "1" ? "TRUE" : "FALSE";
      } else {
        const v = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
        value = v ? unescapeXml(v[1]!) : "";
      }
      cells[col] = value;
    }
    const width = cells.length;
    const row: string[] = [];
    for (let i = 0; i < width; i++) row.push(cells[i] ?? "");
    rows.push(row);
  }
  return rows;
}

function parseCsvText(text: string): string[][] {
  let s = text;
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const first = s.split(/\r?\n/, 1)[0] ?? "";
  const delim = (first.split(";").length > first.split(",").length ? ";" : ",") as "," | ";";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (q) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') {
      q = true;
      continue;
    }
    if (ch === delim) {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n") {
      if (cell.endsWith("\r")) cell = cell.slice(0, -1);
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    if (row.some((c) => c.trim() !== "")) rows.push(row);
  }
  return rows;
}

function isZip(buf: ArrayBuffer) {
  const b = new Uint8Array(buf);
  return b.length >= 4 && u32(b, 0) === PK;
}

function isOle(buf: ArrayBuffer) {
  const b = new Uint8Array(buf);
  return (
    b.length >= 8 &&
    b[0] === 0xd0 &&
    b[1] === 0xcf &&
    b[2] === 0x11 &&
    b[3] === 0xe0
  );
}

export async function readFirstSheetRows(buf: ArrayBuffer): Promise<string[][]> {
  if (isOle(buf)) {
    throw new Error("xls-legacy");
  }
  if (!isZip(buf)) {
    return parseCsvText(new TextDecoder("utf-8").decode(buf));
  }
  const files = await unzip(buf);
  const get = (name: string) => {
    const hit = files.get(name) ?? files.get(name.replace(/\\/g, "/"));
    if (!hit) return null;
    return xmlText(hit);
  };
  const wb = get("xl/workbook.xml");
  if (!wb) throw new Error("xlsx missing workbook");
  const rels = get("xl/_rels/workbook.xml.rels") ?? "";
  const relMap = new Map<string, string>();
  const relRe = /<Relationship\b([^>]*)\/>/g;
  let rm: RegExpExecArray | null;
  while ((rm = relRe.exec(rels))) {
    relMap.set(attr(rm[1]!, "Id"), attr(rm[1]!, "Target"));
  }
  const sheetM = wb.match(/<sheet\b([^>]*)/);
  if (!sheetM) throw new Error("xlsx has no sheet");
  const rid = attr(sheetM[1]!, "id") || attr(sheetM[1]!, "r:id");
  const target = relMap.get(rid) || "worksheets/sheet1.xml";
  const sheetPath = joinPath("xl/workbook.xml", target);
  const sheetXml = get(sheetPath);
  if (!sheetXml) throw new Error("xlsx missing sheet");
  const sstXml = get("xl/sharedStrings.xml") ?? "";
  const sst = sstXml ? parseSst(sstXml) : [];
  return parseSheet(sheetXml, sst);
}

function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  const enc = new TextEncoder();
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = f.data;
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length + data.length);
    w32(local, 0, PK);
    w16(local, 4, 20);
    w16(local, 8, 0);
    w32(local, 14, crc);
    w32(local, 18, data.length);
    w32(local, 22, data.length);
    w16(local, 26, name.length);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    locals.push(local);
    const central = new Uint8Array(46 + name.length);
    w32(central, 0, PK_CENTRAL);
    w16(central, 4, 20);
    w16(central, 6, 20);
    w32(central, 16, crc);
    w32(central, 20, data.length);
    w32(central, 24, data.length);
    w16(central, 28, name.length);
    w32(central, 42, offset);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length;
  }
  const cdSize = centrals.reduce((n, x) => n + x.length, 0);
  const eocd = new Uint8Array(22);
  w32(eocd, 0, PK_EOCD);
  w16(eocd, 8, files.length);
  w16(eocd, 10, files.length);
  w32(eocd, 12, cdSize);
  w32(eocd, 16, offset);
  const out = new Uint8Array(offset + cdSize + 22);
  let p = 0;
  for (const x of locals) {
    out.set(x, p);
    p += x.length;
  }
  for (const x of centrals) {
    out.set(x, p);
    p += x.length;
  }
  out.set(eocd, p);
  return out;
}

function sheetXml(rows: string[][]) {
  const body = rows
    .map((row, ri) => {
      const r = ri + 1;
      const cells = row
        .map((value, ci) => {
          const ref = `${colLetter(ci)}${r}`;
          if (value === "") return `<c r="${ref}"/>`;
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${r}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

export function writeXlsx(sheets: { name: string; rows: string[][] }[]): Uint8Array {
  const enc = new TextEncoder();
  const files: { name: string; data: Uint8Array }[] = [];
  files.push({
    name: "[Content_Types].xml",
    data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheets
  .map(
    (_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  )
  .join("")}
</Types>`),
  });
  files.push({
    name: "_rels/.rels",
    data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
  });
  files.push({
    name: "xl/_rels/workbook.xml.rels",
    data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets
  .map(
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  )
  .join("")}
</Relationships>`),
  });
  files.push({
    name: "xl/workbook.xml",
    data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>
${sheets
  .map(
    (s, i) =>
      `<sheet name="${escapeXml(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
  )
  .join("")}
</sheets>
</workbook>`),
  });
  sheets.forEach((s, i) => {
    files.push({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: enc.encode(sheetXml(s.rows)),
    });
  });
  return zipStore(files);
}

export function downloadXlsx(filename: string, sheets: { name: string; rows: string[][] }[]) {
  const bytes = writeXlsx(sheets);
  const blob = new Blob([asBuffer(bytes)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function rowsToObjects(rows: string[][]): Record<string, unknown>[] {
  const headers = (rows[0] ?? []).map((h) => String(h ?? "").trim());
  if (!headers.some(Boolean)) return [];
  const out: Record<string, unknown>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const obj: Record<string, unknown> = {};
    let any = false;
    headers.forEach((h, c) => {
      if (!h) return;
      const v = String(row[c] ?? "").trim();
      obj[h] = v;
      if (v) any = true;
    });
    if (any) out.push(obj);
  }
  return out;
}
