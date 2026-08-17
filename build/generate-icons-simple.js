/**
 * Simple icon generator for FocusStudy - pure JS, no native deps
 * Creates ICO and PNG files using basic buffer manipulation
 * Run with: node build/generate-icons-simple.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const buildDir = __dirname;

// Simple PNG generator - creates a valid minimal PNG
function createPng(size) {
  // Create a simple colored square PNG with the FocusStudy colors
  // This is a minimal valid PNG

  // For simplicity, we'll create a solid color PNG
  // Width, height, bit depth (8), color type (2 = RGB), compression, filter, interlace
  const width = size;
  const height = size;

  // Create image data (raw RGB)
  const bytesPerPixel = 3;
  const stride = width * bytesPerPixel;
  const imageData = Buffer.alloc((stride + 1) * height); // +1 for filter byte per row

  // Fill with gradient-like pattern (simplified)
  for (let y = 0; y < height; y++) {
    imageData[y * (stride + 1)] = 0; // filter type 0 (none)
    for (let x = 0; x < width; x++) {
      const idx = y * (stride + 1) + 1 + x * bytesPerPixel;
      // Dark background with subtle gradient
      const t = (x + y) / (width + height);
      const r = Math.floor(15 + t * 20);    // ~0f172a to ~1e293b
      const g = Math.floor(23 + t * 20);
      const b = Math.floor(42 + t * 20);
      imageData[idx] = r;
      imageData[idx + 1] = g;
      imageData[idx + 2] = b;
    }
  }

  // Compress with zlib
  const compressed = zlib.deflateSync(imageData);

  // PNG structure
  const pngChunks = [];

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);    // bit depth
  ihdr.writeUInt8(2, 9);    // color type: RGB
  ihdr.writeUInt8(0, 10);   // compression
  ihdr.writeUInt8(0, 11);   // filter
  ihdr.writeUInt8(0, 12);   // interlace
  pngChunks.push(createChunk('IHDR', ihdr));

  // IDAT chunk
  pngChunks.push(createChunk('IDAT', compressed));

  // IEND chunk
  pngChunks.push(createChunk('IEND', Buffer.alloc(0)));

  // PNG signature + chunks
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  return Buffer.concat([signature, ...pngChunks]);
}

function createChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type);
  const crc = zlib.crc32(Buffer.concat([typeBuf, data]));
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

// Create a simple ICO file
function createIco() {
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = [];

  for (const size of sizes) {
    const png = createPng(size);
    images.push({ size, data: png });
  }

  // ICO header (6 bytes)
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);      // reserved
  header.writeUInt16LE(1, 2);      // type (1 = ICO)
  header.writeUInt16LE(images.length, 4); // count

  // Directory entries (16 bytes each)
  const dirEntries = [];
  let offset = 6 + images.length * 16;

  for (const img of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(img.size === 256 ? 0 : img.size, 0); // width (0 = 256)
    entry.writeUInt8(img.size === 256 ? 0 : img.size, 1); // height (0 = 256)
    entry.writeUInt8(0, 2);      // color count
    entry.writeUInt8(0, 3);      // reserved
    entry.writeUInt16LE(1, 4);   // planes
    entry.writeUInt16LE(32, 6);  // bit count
    entry.writeUInt32LE(img.data.length, 8); // size of image data
    entry.writeUInt32LE(offset, 12); // offset
    dirEntries.push(entry);
    offset += img.data.length;
  }

  const ico = Buffer.concat([header, ...dirEntries, ...images.map(i => i.data)]);
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), ico);
  console.log('Created icon.ico');

  // Also save PNGs
  for (const img of images) {
    fs.writeFileSync(path.join(buildDir, `icon-${img.size}.png`), img.data);
    console.log(`Created icon-${img.size}.png`);
  }
}

createIco();
console.log('All icons generated!');