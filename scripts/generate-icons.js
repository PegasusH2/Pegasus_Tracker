// Genera los iconos PWA (PNG) sin dependencias externas, usando solo zlib de Node.
// Dibuja un fondo con degradado simple + una barra ("dumbbell") como icono.
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

function crc32(buf) {
  let c, crcTable = crc32.table || (crc32.table = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function drawIcon(size, { padding = 0 } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const bg = hexToRgb('#0d0d0d');
  const accent = hexToRgb('#E0342A');
  const cx = size / 2, cy = size / 2;
  const contentR = (size / 2) - padding;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      rgba[idx] = bg[0]; rgba[idx + 1] = bg[1]; rgba[idx + 2] = bg[2]; rgba[idx + 3] = 255;
    }
  }

  // "Dumbbell" simple: barra horizontal + dos discos en los extremos, centrado en el area de contenido
  const barW = contentR * 1.15;
  const barH = Math.max(2, contentR * 0.10);
  const discW = Math.max(3, contentR * 0.22);
  const discH = contentR * 0.62;

  function fillRect(x0, y0, w, h, color) {
    const rx0 = Math.round(cx + x0), ry0 = Math.round(cy + y0);
    const rx1 = Math.round(cx + x0 + w), ry1 = Math.round(cy + y0 + h);
    for (let y = Math.max(0, ry0); y < Math.min(size, ry1); y++) {
      for (let x = Math.max(0, rx0); x < Math.min(size, rx1); x++) {
        const idx = (y * size + x) * 4;
        rgba[idx] = color[0]; rgba[idx + 1] = color[1]; rgba[idx + 2] = color[2]; rgba[idx + 3] = 255;
      }
    }
  }

  fillRect(-barW / 2, -barH / 2, barW, barH, accent);
  fillRect(-barW / 2 - discW, -discH / 2, discW, discH, accent);
  fillRect(barW / 2, -discH / 2, discW, discH, accent);

  return encodePNG(size, size, rgba);
}

const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const targets = [
  { name: 'icon-32.png', size: 32, padding: 4 },
  { name: 'icon-180.png', size: 180, padding: 20 }, // apple-touch-icon (sin transparencia, con margen)
  { name: 'icon-192.png', size: 192, padding: 16 },
  { name: 'icon-512.png', size: 512, padding: 40 },
  { name: 'icon-maskable-512.png', size: 512, padding: 90 }, // más margen para safe zone maskable
];

for (const t of targets) {
  const png = drawIcon(t.size, { padding: t.padding });
  fs.writeFileSync(path.join(outDir, t.name), png);
  console.log('Generado', t.name, png.length, 'bytes');
}
