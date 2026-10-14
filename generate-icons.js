const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  let crc = 0 ^ (-1);
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ (-1)) >>> 0;
}

function createChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crcBuf]);
}

function generatePNG(size, primaryColor, accentColor) {
  const width = size;
  const height = size;

  // Raw image data: height rows, each row starts with filter byte 0, followed by RGBA pixels
  const rawRows = [];
  const radius = size * 0.45;
  const center = size / 2;

  for (let y = 0; y < height; y++) {
    const row = [0]; // filter type None
    for (let x = 0; x < width; x++) {
      const dx = x - center;
      const dy = y - center;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= radius) {
        // Gradient from primary to accent
        const factor = (x + y) / (width + height);
        const r = Math.round(primaryColor[0] * (1 - factor) + accentColor[0] * factor);
        const g = Math.round(primaryColor[1] * (1 - factor) + accentColor[1] * factor);
        const b = Math.round(primaryColor[2] * (1 - factor) + accentColor[2] * factor);
        
        // Inner bag/cart shape highlight (center square-ish)
        const inBag = (Math.abs(dx) < size * 0.22 && Math.abs(dy - size * 0.05) < size * 0.22);
        if (inBag) {
          row.push(255, 255, 255, 255); // White inner cart
        } else {
          row.push(r, g, b, 255);
        }
      } else {
        // Transparent outside circle
        row.push(0, 0, 0, 0);
      }
    }
    rawRows.push(Buffer.from(row));
  }

  const rawData = Buffer.concat(rawRows);
  const compressedData = zlib.deflateSync(rawData);

  // PNG Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8); // 8-bit depth
  ihdrData.writeUInt8(6, 9); // Color type 6: RGBA
  ihdrData.writeUInt8(0, 10); // Compression method 0
  ihdrData.writeUInt8(0, 11); // Filter method 0
  ihdrData.writeUInt8(0, 12); // Interlace method 0
  const ihdrChunk = createChunk('IHDR', ihdrData);

  // IDAT chunk
  const idatChunk = createChunk('IDAT', compressedData);

  // IEND chunk
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// TikTok Magenta / Red: [254, 44, 85], Cyan / Blue: [37, 244, 238]
const magenta = [254, 44, 85];
const cyan = [37, 244, 238];

[16, 48, 128].forEach(size => {
  const png = generatePNG(size, magenta, cyan);
  const filePath = path.join(iconsDir, `icon-${size}.png`);
  fs.writeFileSync(filePath, png);
  console.log(`Generated: ${filePath} (${size}x${size}, ${png.length} bytes)`);
});
