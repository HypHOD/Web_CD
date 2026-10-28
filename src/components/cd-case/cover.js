const MAX_TAG = 32 * 1024 * 1024;
const CONTAINERS = new Set(['moov', 'udta', 'meta', 'ilst']);

const ascii = (bytes, from, to) => {
  let s = '';
  for (let i = from; i < to; i++) s += String.fromCharCode(bytes[i]);
  return s;
};

const syncsafe = (b, o) =>
  ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);

const uint32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

const uint24 = (b, o) => (b[o] << 16) | (b[o + 1] << 8) | b[o + 2];

function textEnd(bytes, start, encoding) {
  if (encoding === 1 || encoding === 2) {
    for (let i = start; i + 1 < bytes.length; i += 2) {
      if (bytes[i] === 0 && bytes[i + 1] === 0) return i;
    }
    return bytes.length;
  }
  for (let i = start; i < bytes.length; i++) if (bytes[i] === 0) return i;
  return bytes.length;
}

function pictureFrom(frame, version) {
  if (frame.length < 6) return null;
  const encoding = frame[0];
  let mime;
  let at;
  if (version === 2) {
    const format = ascii(frame, 1, 4).toLowerCase();
    mime = format === 'png' ? 'image/png' : 'image/jpeg';
    at = 4;
  } else {
    let i = 1;
    while (i < frame.length && frame[i] !== 0) i++;
    mime = ascii(frame, 1, i) || 'image/jpeg';
    at = i + 1;
  }
  at += 1; // picture type
  const end = textEnd(frame, at, encoding);
  const start = end + ((encoding === 1 || encoding === 2) && end < frame.length ? 2 : 1);
  if (start >= frame.length) return null;
  return new Blob([frame.subarray(start)], { type: mime });
}

async function id3Cover(file) {
  const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  if (head.length < 10 || ascii(head, 0, 3) !== 'ID3') return null;
  const version = head[3];
  if (version < 2 || version > 4) return null;
  const size = syncsafe(head, 6);
  if (!size || size > MAX_TAG) return null;
  const tag = new Uint8Array(await file.slice(10, 10 + size).arrayBuffer());
  const header = version === 2 ? 6 : 10;
  let at = 0;
  while (at + header <= tag.length) {
    if (tag[at] === 0) break;
    const id = ascii(tag, at, at + (version === 2 ? 3 : 4));
    const length = version === 2 ? uint24(tag, at + 3) : version === 4 ? syncsafe(tag, at + 4) : uint32(tag, at + 4);
    if (!length) break;
    const from = at + header;
    const to = Math.min(from + length, tag.length);
    if (id === 'APIC' || id === 'PIC') return pictureFrom(tag.subarray(from, to), version);
    at = to;
  }
  return null;
}

async function flacCover(file) {
  let offset = 4;
  while (offset + 4 <= file.size) {
    const head = new Uint8Array(await file.slice(offset, offset + 4).arrayBuffer());
    if (head.length < 4) return null;
    const last = (head[0] & 0x80) !== 0;
    const type = head[0] & 0x7f;
    const size = uint24(head, 1);
    const start = offset + 4;
    const end = start + size;
    if (type === 6 && size <= MAX_TAG) {
      const block = new Uint8Array(await file.slice(start, Math.min(end, file.size)).arrayBuffer());
      if (block.length < 32) return null;
      let at = 4;
      const mimeLength = uint32(block, at);
      at += 4;
      if (at + mimeLength + 4 > block.length) return null;
      const mime = ascii(block, at, at + mimeLength) || 'image/jpeg';
      at += mimeLength;
      const descLength = uint32(block, at);
      at += 4;
      if (at + descLength + 20 > block.length) return null;
      at += descLength + 16;
      const dataLength = uint32(block, at);
      at += 4;
      if (!dataLength || at + dataLength > block.length) return null;
      return new Blob([block.subarray(at, at + dataLength)], { type: mime });
    }
    if (last) return null;
    offset = end;
  }
  return null;
}

async function boxAt(file, offset, end) {
  if (offset + 8 > end) return null;
  const head = new Uint8Array(await file.slice(offset, Math.min(offset + 16, end)).arrayBuffer());
  if (head.length < 8) return null;
  let size = uint32(head, 0);
  const type = ascii(head, 4, 8);
  let header = 8;
  if (size === 1) {
    if (head.length < 16) return null;
    size = Number((BigInt(uint32(head, 8)) << 32n) | BigInt(uint32(head, 12)));
    header = 16;
  } else if (size === 0) {
    size = end - offset;
  }
  if (size < header) return null;
  return { size, type, header };
}

async function findBox(file, start, end, target, depth = 0) {
  let offset = start;
  while (offset + 8 <= end) {
    const box = await boxAt(file, offset, end);
    if (!box) return null;
    const bodyStart = offset + box.header;
    const bodyEnd = Math.min(offset + box.size, end);
    if (box.type === target) return { start: bodyStart, end: bodyEnd };
    if (depth < 6 && CONTAINERS.has(box.type)) {
      const found = await findBox(file, bodyStart + (box.type === 'meta' ? 4 : 0), bodyEnd, target, depth + 1);
      if (found) return found;
    }
    offset += box.size;
  }
  return null;
}

async function mp4Cover(file) {
  const covr = await findBox(file, 0, file.size, 'covr');
  if (!covr) return null;
  const data = await findBox(file, covr.start, covr.end, 'data');
  if (!data || data.end - data.start <= 8) return null;
  const head = new Uint8Array(await file.slice(data.start, data.start + 8).arrayBuffer());
  if (head.length < 8) return null;
  const type = uint32(head, 0);
  const mime = type === 14 ? 'image/png' : type === 12 ? 'image/gif' : type === 27 ? 'image/bmp' : 'image/jpeg';
  return file.slice(data.start + 8, data.end, mime);
}

export async function readCover(file) {
  try {
    const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (ascii(head, 0, 3) === 'ID3') return await id3Cover(file);
    if (ascii(head, 0, 4) === 'fLaC') return await flacCover(file);
    if (ascii(head, 4, 8) === 'ftyp') return await mp4Cover(file);
    return null;
  } catch {
    return null;
  }
}
