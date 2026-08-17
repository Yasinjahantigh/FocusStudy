/**
 * Simple icon generator for FocusStudy
 * Creates ICO and PNG files from the SVG
 * Run with: node build/generate-icons.js
 */
const fs = require('fs');
const path = require('path');

const buildDir = path.join(__dirname);

// Read the SVG
const svg = fs.readFileSync(path.join(buildDir, 'icon.svg'), 'utf-8');

// Create a simple PNG by using a data URL approach
// We'll create placeholder files that can be replaced with proper ones

// For now, create a simple approach - write a basic ICO header with multiple sizes
// This is a minimal ICO with a single 256x256 PNG embedded

// Actually, let's just create a simple node script that uses a basic canvas approach
// We'll create simple solid color icons for now - can be replaced with proper ones

const { createCanvas } = require('canvas');

// Create canvas and draw icon
function createIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Background
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, '#0f172a');
  gradient.addColorStop(1, '#1e293b');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  // Rounded rect clip
  const radius = size * 0.1875; // 96/512 ratio
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(size - radius, 0);
  ctx.quadraticCurveTo(size, 0, size, radius);
  ctx.lineTo(size, size - radius);
  ctx.quadraticCurveTo(size, size, size - radius, size);
  ctx.lineTo(radius, size);
  ctx.quadraticCurveTo(0, size, 0, size - radius);
  ctx.lineTo(0, radius);
  ctx.quadraticCurveTo(0, 0, radius, 0);
  ctx.clip();

  // Timer circle
  const center = size / 2;
  const circleRadius = size * 0.35; // 180/512 ratio
  const strokeWidth = size * 0.047; // 24/512 ratio

  const circleGradient = ctx.createLinearGradient(0, 0, size, size);
  circleGradient.addColorStop(0, '#10B981');
  circleGradient.addColorStop(1, '#06B6D4');

  ctx.strokeStyle = circleGradient;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(center, center, circleRadius, -Math.PI / 2, Math.PI * 1.5);
  ctx.stroke();

  // Sparkle in center
  const sparkleSize = size * 0.07; // ~36px at 512
  ctx.fillStyle = '#10B981';
  ctx.beginPath();
  ctx.moveTo(center, center - sparkleSize * 0.44);
  ctx.lineTo(center + sparkleSize * 0.08, center - sparkleSize * 0.11);
  ctx.lineTo(center + sparkleSize * 0.36, center - sparkleSize * 0.11);
  ctx.lineTo(center + sparkleSize * 0.14, center + sparkleSize * 0.08);
  ctx.lineTo(center + sparkleSize * 0.22, center + sparkleSize * 0.36);
  ctx.lineTo(center, center + sparkleSize * 0.19);
  ctx.lineTo(center - sparkleSize * 0.22, center + sparkleSize * 0.36);
  ctx.lineTo(center - sparkleSize * 0.14, center + sparkleSize * 0.08);
  ctx.lineTo(center - sparkleSize * 0.36, center - sparkleSize * 0.11);
  ctx.lineTo(center - sparkleSize * 0.08, center - sparkleSize * 0.11);
  ctx.closePath();
  ctx.fill();

  // Small accent sparkles
  ctx.fillStyle = '#06B6D4';
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.arc(center * 0.47, center * 0.47, size * 0.015, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(center * 1.53, center * 1.53, size * 0.012, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  return canvas.toBuffer('image/png');
}

// Generate PNG sizes
const sizes = [16, 24, 32, 48, 64, 128, 256, 512];

for (const size of sizes) {
  const png = createIcon(size);
  fs.writeFileSync(path.join(buildDir, `icon-${size}.png`), png);
  console.log(`Created icon-${size}.png`);
}

// Create a simple ICO file (multi-size)
// ICO format: header (6) + dir entries (16 bytes each) + image data
function createIco() {
  const images = [];
  for (const size of [16, 24, 32, 48, 64, 128, 256]) {
    const png = createIcon(size);
    images.push({ size, data: png });
  }

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type (1 = ICO)
  header.writeUInt16LE(images.length, 4); // count

  const dirEntries = [];
  let offset = 6 + images.length * 16;

  for (const img of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(img.size === 256 ? 0 : img.size, 0); // width (0 = 256)
    entry.writeUInt8(img.size === 256 ? 0 : img.size, 1); // height (0 = 256)
    entry.writeUInt8(0, 2); // color count
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bit count
    entry.writeUInt32LE(img.data.length, 8); // size of image data
    entry.writeUInt32LE(offset, 12); // offset
    dirEntries.push(entry);
    offset += img.data.length;
  }

  const ico = Buffer.concat([header, ...dirEntries, ...images.map(i => i.data)]);
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), ico);
  console.log('Created icon.ico');
}

createIco();

console.log('All icons generated!');