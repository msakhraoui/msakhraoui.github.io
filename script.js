"use strict";

const canvas = document.getElementById("backgroundCanvas");
canvas.style.imageRendering = "pixelated";

/* ---------- tuning ---------- */
const targetColumns = 320;
const FPS = 30;
const frameDelay = 1000 / FPS;
const CLOUD_DRIFT = 0.06;
const SHADOW_STRENGTH = 0.26;

/* ---------- palette / glyphs ---------- */
const ramp = " `.-':_,^=;><+!rc*/z?sLTv)J7(|Fi{C}fI31tlu[neoZ5Yxjya]2ESwqkP6h9d4VpOGbUAKXHm8RD#$Bg0MNWQ%&@";
const glyphs = ramp + "\\~";
const rampLength = ramp.length;
const slashGlyph = glyphs.indexOf("/");
const backslashGlyph = glyphs.indexOf("\\");
const barGlyph = glyphs.indexOf("|");
const starGlyph = glyphs.indexOf("*");
const gDot = glyphs.indexOf(".");
const layerBias = [-0.38, -0.12, -0.02, 0.14, 0.05, 0.1];
const leafGlyphs = "*%&~";

const skyTop = [24, 92, 196], skyMiddle = [72, 156, 234], skyLow = [168, 208, 240];
const hazeColor = [176, 204, 228], sunGlow = [255, 214, 130], sunCore = [255, 244, 200];
const leafColors = [[190, 210, 70], [226, 170, 48], [214, 110, 34], [150, 190, 60]];
const treeTints = {
  green:  { dark: [12, 48, 24],  light: [170, 206, 66] },
  autumn: { dark: [116, 48, 16], light: [248, 180, 50] }
};
const crownBlobs = [
  [0, 0, 1], [-0.85, 0.3, 0.7], [0.85, 0.25, 0.75],
  [-0.4, -0.6, 0.65], [0.45, -0.65, 0.62], [0, -1, 0.5],
  [-1.2, 0.7, 0.45], [1.2, 0.65, 0.5]
];

/* ---------- state ---------- */
let cellWidth = 0, cellHeight = 0, cols = 0, rows = 0;
let aspect = 1, colUnit = 0, rowUnit = 0;
let isPhone = false, treeScale = 1;
let baseColors, baseChars, layerMap, flowerMap, treeMask, frameColors, frameU8, frameChars;
let uxTable, uyTable, farTops, midTops, forestTops, meadowTops, frontTops;
let trees = [], leafTrees = [], leaves = [], rabbits = [];
let sun = { x: 1, y: 0.25 };
let lastFrame = 0, timeSec = 0, rafId = 0;

/* ---------- fast sin ---------- */
const SIN_SIZE = 4096, SIN_SCALE = SIN_SIZE / (Math.PI * 2);
const sinTable = new Float32Array(SIN_SIZE);
for (let i = 0; i < SIN_SIZE; i++) sinTable[i] = Math.sin(i / SIN_SCALE);
function fastSin(x) {
  let idx = (x * SIN_SCALE) % SIN_SIZE;
  if (idx < 0) idx += SIN_SIZE;
  return sinTable[idx | 0];
}

let seed = 12345;
function random() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function smoothStep(lo, hi, v) { const t = clamp((v - lo) / (hi - lo), 0, 1); return t * t * (3 - 2 * t); }
function mixColor(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }

function hash(x, y) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function noise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fractal(x, y, octaves) {
  let sum = 0, amp = 0.5, total = 0;
  for (let i = 0; i < octaves; i++) { sum += noise(x, y) * amp; total += amp; x *= 2; y *= 2; amp *= 0.5; }
  return sum / total;
}
function ridged(x, y, octaves) {
  let sum = 0, amp = 0.5, total = 0;
  for (let i = 0; i < octaves; i++) { sum += (1 - Math.abs(noise(x, y) * 2 - 1)) * amp; total += amp; x *= 2; y *= 2; amp *= 0.5; }
  return sum / total;
}

function densityGlyph(color, bias) {
  const lum = (color[0] * 0.3 + color[1] * 0.59 + color[2] * 0.11) / 255;
  return Math.floor(clamp(0.12 + lum * 0.9 + bias, 0, 1) * (rampLength - 1));
}

/* ---------- terrain ---------- */
function meadowTopAt(ux) { return 0.67 + 0.025 * Math.sin(ux * 2.6 + 1) + 0.012 * Math.sin(ux * 6.1); }
function frontTopAt(ux)  { return 0.8 + 0.04 * Math.sin(ux * 1.9 + 3) + 0.015 * Math.sin(ux * 5.3 + 1); }
function farTopAt(ux) {
  const r = ridged(ux * 1.9 + 3, 1.7, 4);
  return 0.52 - 0.30 * Math.pow(clamp(r, 0, 1), 1.35);
}
function midTopAt(ux) {
  const r = ridged(ux * 2.6 + 9, 4.3, 4);
  return 0.60 - 0.17 * Math.pow(clamp(r, 0, 1), 1.4);
}
function forestTopAt(ux) {
  const slot = ux * 55;
  const tri = 1 - Math.abs((slot - Math.floor(slot)) * 2 - 1);
  return 0.625 - 0.035 * fractal(ux * 3 + 20, 2.2, 3) - 0.03 * hash(Math.floor(slot), 7) * (0.4 + 0.6 * tri);
}
function buildTerrain() {
  farTops = new Float32Array(cols); midTops = new Float32Array(cols); forestTops = new Float32Array(cols);
  meadowTops = new Float32Array(cols); frontTops = new Float32Array(cols);
  for (let col = 0; col < cols; col++) {
    const ux = uxTable[col];
    farTops[col] = farTopAt(ux); midTops[col] = midTopAt(ux); forestTops[col] = forestTopAt(ux);
    meadowTops[col] = meadowTopAt(ux); frontTops[col] = frontTopAt(ux);
  }
}

/* ---------- static scene colors ---------- */
function skyColorAt(ux, uy) {
  const t = clamp(uy / 0.64, 0, 1);
  let color = t < 0.55 ? mixColor(skyTop, skyMiddle, t / 0.55) : mixColor(skyMiddle, skyLow, (t - 0.55) / 0.45);
  const dx = ux - sun.x, dy = uy - sun.y;
  const distance = dx * dx + dy * dy;
  color = mixColor(color, sunGlow, Math.exp(-distance * 12) * 0.5);
  if (distance < 0.0007) color = sunCore;
  return color;
}
function mountainColorAt(ux, uy, scale, lightColor, darkColor, haze, snowy) {
  const detail = fractal(ux * scale, uy * scale, 4);
  const slope = detail - fractal(ux * scale + 0.06, uy * scale - 0.05, 4);
  const light = clamp(0.5 + slope * 5, 0, 1);
  let color = mixColor(darkColor, lightColor, light);
  if (snowy && uy < 0.30 + (detail - 0.5) * 0.06) {
    color = mixColor(color, [206, 220, 236], clamp(0.2 + light * 0.3, 0, 1));
  }
  return mixColor(color, hazeColor, haze);
}
function forestColorAt(col, row, ux, uy) {
  const tone = fractal(ux * 34, uy * 34, 2);
  const speck = hash(col, row);
  let color = mixColor([12, 42, 26], [62, 116, 54], clamp(tone * 1.15 + (speck - 0.5) * 0.5, 0, 1));
  const depth = clamp((uy - forestTops[col]) / 0.05, 0, 1);
  color = mixColor(color, [96, 150, 76], (1 - depth) * 0.25);
  return mixColor(color, hazeColor, 0.1);
}
function meadowColorAt(col, row, ux, uy) {
  const patch = fractal(ux * 6, uy * 12, 4);
  let color = mixColor([86, 146, 50], [176, 182, 66], smoothStep(0.35, 0.65, patch));
  color = mixColor(color, [44, 96, 40], hash(col, row) * 0.25);
  color = mixColor(color, hazeColor, 0.22 * (1 - clamp((uy - meadowTops[col]) / 0.08, 0, 1)));
  return color;
}
function groundColorAt(col, row, ux, uy) {
  const patch = fractal(ux * 9, uy * 16, 4);
  let color = mixColor([30, 80, 28], [116, 164, 50], smoothStep(0.3, 0.7, patch));
  color = mixColor(color, [14, 44, 20], clamp((uy - 0.8) / 0.2, 0, 1) * 0.55);
  return mixColor(color, [60, 120, 34], hash(col, row) * 0.18);
}
function flowerAt(layer, col, row) {
  const limit = isPhone ? (layer === 4 ? 0.995 : 0.997) : (layer === 4 ? 0.987 : 0.993);
  if (hash(col + 101, row + 57) < limit) return null;
  const pick = hash(col + 9, row + 31);
  if (pick < 0.45) return [252, 238, 120];
  if (pick < 0.8) return [255, 255, 255];
  return [198, 120, 224];
}
function baseColorAt(layer, col, row, ux, uy) {
  if (layer === 0) return skyColorAt(ux, uy);
  if (layer === 1) return mountainColorAt(ux, uy, 11, [112, 132, 176], [58, 72, 118], 0.42, true);
  if (layer === 2) return mountainColorAt(ux, uy, 17, [74, 108, 112], [28, 52, 66], 0.22, false);
  if (layer === 3) return forestColorAt(col, row, ux, uy);
  if (layer === 4) return meadowColorAt(col, row, ux, uy);
  return groundColorAt(col, row, ux, uy);
}

/* ---------- wind ---------- */
let windCells, windP1, windP2, windAmp, windBlade, windCount = 0;

function buildScene() {
  const total = cols * rows;
  baseColors = new Uint8ClampedArray(total * 4);
  baseChars = new Uint8Array(total);
  layerMap = new Uint8Array(total);
  flowerMap = new Uint8Array(total);
  treeMask = new Uint8Array(total);

  for (let row = 0; row < rows; row++) {
    const uy = uyTable[row];
    for (let col = 0; col < cols; col++) {
      const ux = uxTable[col];
      let layer = 0;
      if (uy >= frontTops[col]) layer = 5;
      else if (uy >= meadowTops[col]) layer = 4;
      else if (uy >= forestTops[col]) layer = 3;
      else if (uy >= midTops[col]) layer = 2;
      else if (uy >= farTops[col]) layer = 1;
      const flower = layer >= 4 ? flowerAt(layer, col, row) : null;
      const color = flower || baseColorAt(layer, col, row, ux, uy);
      const index = row * cols + col;
      layerMap[index] = layer;
      flowerMap[index] = flower ? 1 : 0;
      baseColors[index * 4] = color[0];
      baseColors[index * 4 + 1] = color[1];
      baseColors[index * 4 + 2] = color[2];
      baseColors[index * 4 + 3] = 255;
      baseChars[index] = flower ? starGlyph : densityGlyph(color, layerBias[layer] + (hash(col, row) - 0.5) * 0.2);
    }
  }

  const idxs = [], p1 = [], p2 = [], amp = [], blade = [];
  for (let row = 0; row < rows; row++) {
    const uy = uyTable[row];
    if (uy < 0.62) continue;
    for (let col = 0; col < cols; col++) {
      const index = row * cols + col;
      const layer = layerMap[index];
      if (layer < 4 || flowerMap[index]) continue;
      idxs.push(index);
      p1.push(uxTable[col] * 15 + uy * 5);
      p2.push(uxTable[col] * 41);
      amp.push(layer === 5 ? 0.12 : 0.07);
      blade.push(hash(col, row + 500) > (layer === 5 ? 0.3 : 0.6) ? 1 : 0);
    }
  }
  windCells = Uint32Array.from(idxs);
  windP1 = Float32Array.from(p1);
  windP2 = Float32Array.from(p2);
  windAmp = Float32Array.from(amp);
  windBlade = Uint8Array.from(blade);
  windCount = idxs.length;
}

/* ---------- clouds ---------- */
let cloudShape, cloudSun;
let cloudCells, cloudCol, cloudFade, cloudBase, cloudDepth, cloudCount = 0, cloudN = 0;
let cloudStep = 0, cloudXScale = 1.7;

function buildCloudCache() {
  const limit = Math.min(rows, Math.ceil(0.6 / rowUnit));
  const rowSlot = new Int32Array(rows).fill(-1);
  const rowFade = [];
  let slots = 0;
  for (let row = 0; row < limit; row++) {
    const uy = uyTable[row];
    const fade = smoothStep(0.02, 0.14, uy) * (1 - smoothStep(0.40, 0.55, uy));
    if (fade <= 0) continue;
    rowSlot[row] = slots++;
    rowFade.push(fade);
  }

  cloudXScale = 3.3 / aspect;
  cloudStep = colUnit * cloudXScale;
  cloudN = cols + Math.ceil((CLOUD_DRIFT * 60 + 0.1) / cloudStep) + 2;
  cloudShape = new Float32Array(slots * cloudN);
  cloudSun   = new Float32Array(slots * cloudN);
  for (let row = 0; row < limit; row++) {
    const slot = rowSlot[row];
    if (slot < 0) continue;
    const sy = uyTable[row] * 3.6, base = slot * cloudN;
    for (let j = 0; j < cloudN; j++) {
      const sx = j * cloudStep;
      cloudShape[base + j] = fractal(sx, sy, 5);
      cloudSun[base + j]   = fractal(sx + 0.03, sy - 0.04, 4);
    }
  }

  const idxs = [], colArr = [], fade = [], base = [], depth = [];
  for (let row = 0; row < limit; row++) {
    const slot = rowSlot[row];
    if (slot < 0) continue;
    for (let col = 0; col < cols; col++) {
      const index = row * cols + col;
      const layer = layerMap[index];
      if (layer > 2 || treeMask[index]) continue;
      idxs.push(index);
      colArr.push(col);
      fade.push(rowFade[slot]);
      base.push(slot * cloudN);
      depth.push(layer === 0 ? 1 : layer === 1 ? 0.62 : 0.42);
    }
  }
  cloudCells = Uint32Array.from(idxs);
  cloudCol   = Uint32Array.from(colArr);
  cloudFade  = Float32Array.from(fade);
  cloudBase  = Uint32Array.from(base);
  cloudDepth = Float32Array.from(depth);
  cloudCount = idxs.length;
}

function paintClouds(time) {
  const s = ((time % 60) * CLOUD_DRIFT) / cloudStep + 0.5;
  const shift = s | 0, f = s - shift;
  for (let k = 0; k < cloudCount; k++) {
    const a0 = cloudBase[k] + cloudCol[k] + shift;
    const a1 = a0 + 1;
    const shape = cloudShape[a0] + (cloudShape[a1] - cloudShape[a0]) * f;

    let t = (shape - 0.57) * 10; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const depth = cloudDepth[k];
    const cover = t * t * (3 - 2 * t) * cloudFade[k] * depth;
    if (cover < 0.04) continue;

    const sunSide = cloudSun[a0] + (cloudSun[a1] - cloudSun[a0]) * f;
    const light = clamp(0.6 + (shape - sunSide) * 7, 0, 1);
    const hz = (1 - depth) * 0.5;
    const cr = lerp(146 + 109 * light, hazeColor[0], hz);
    const cg = lerp(170 + 82 * light, hazeColor[1], hz);
    const cb = lerp(212 + 32 * light, hazeColor[2], hz);

    const idx = cloudCells[k], p = idx * 4;
    const m = cover * 1.15 > 1 ? 1 : cover * 1.15;
    const r = frameColors[p]     + (cr - frameColors[p])     * m;
    const g = frameColors[p + 1] + (cg - frameColors[p + 1]) * m;
    const b = frameColors[p + 2] + (cb - frameColors[p + 2]) * m;
    frameColors[p] = r; frameColors[p + 1] = g; frameColors[p + 2] = b;

    const lum = (r * 0.3 + g * 0.59 + b * 0.11) / 255;
    const bias = -0.3 + (cover > 1 ? 1 : cover) * 0.32;
    frameChars[idx] = (clamp(0.12 + lum * 0.9 + bias, 0, 1) * (rampLength - 1)) | 0;
  }
}

/* ---------- cloud shadows ---------- */
let shadowStrip, shadowCells, shadowCol, shadowBase, shadowCount = 0;

function buildShadowCache() {
  const rowSlot = new Int32Array(rows).fill(-1);
  let slots = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col;
      if (layerMap[idx] >= 4 && !flowerMap[idx] && !treeMask[idx]) { rowSlot[row] = slots++; break; }
    }
  }
  shadowStrip = new Float32Array(slots * cloudN);
  for (let row = 0; row < rows; row++) {
    const slot = rowSlot[row];
    if (slot < 0) continue;
    const sy = uyTable[row], base = slot * cloudN;
    for (let j = 0; j < cloudN; j++) {
      const sx = j * cloudStep + 0.7;
      shadowStrip[base + j] = smoothStep(0.55, 0.70, fractal(sx, sy * 2.4 + 5.0, 4));
    }
  }
  const idxs = [], colArr = [], base = [];
  for (let row = 0; row < rows; row++) {
    const slot = rowSlot[row];
    if (slot < 0) continue;
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col;
      if (layerMap[idx] < 4 || flowerMap[idx] || treeMask[idx]) continue;
      idxs.push(idx);
      colArr.push(col);
      base.push(slot * cloudN);
    }
  }
  shadowCells = Uint32Array.from(idxs);
  shadowCol   = Uint32Array.from(colArr);
  shadowBase  = Uint32Array.from(base);
  shadowCount = idxs.length;
}

function paintShadows(time) {
  const s = ((time % 60) * CLOUD_DRIFT) / cloudStep + 0.5;
  const shift = s | 0, f = s - shift;
  for (let k = 0; k < shadowCount; k++) {
    const a0 = shadowBase[k] + shadowCol[k] + shift;
    const a1 = a0 + 1;
    const c = shadowStrip[a0] + (shadowStrip[a1] - shadowStrip[a0]) * f;
    if (c < 0.03) continue;
    const factor = 1 - c * SHADOW_STRENGTH;
    const p = shadowCells[k] * 4;
    frameColors[p] *= factor; frameColors[p + 1] *= factor; frameColors[p + 2] *= factor;
  }
}

function paintWind(time) {
  const t1 = time * (Math.PI * 2 * 20 / 60);
  const t2 = time * (Math.PI * 2 * 32 / 60);
  for (let k = 0; k < windCount; k++) {
    const wave = fastSin(windP1[k] + t1) + 0.5 * fastSin(windP2[k] + t2);
    const gust = 1 + wave * windAmp[k];
    const idx = windCells[k], p = idx * 4;
    frameColors[p] *= gust; frameColors[p + 1] *= gust; frameColors[p + 2] *= gust;
    if (windBlade[k]) {
      frameChars[idx] = wave > 0.45 ? slashGlyph : wave < -0.45 ? backslashGlyph : barGlyph;
    }
  }
}

/* ---------- trees (scaled down on phones) ---------- */
function makeTrees() {
  const specs = [
    { fx: 0.4, ground: "meadow", size: 0.04, trunk: 0.04, tint: "green", haze: 0.3 },
    { fx: 0.6, ground: "meadow", size: 0.045, trunk: 0.045, tint: "green", haze: 0.3 },
    { fx: 0.24, ground: "meadow", size: 0.075, trunk: 0.075, tint: "green", haze: 0.15 },
    { fx: 0.79, ground: "meadow", size: 0.07, trunk: 0.07, tint: "autumn", haze: 0.15 },
    { fx: 0.05, ground: "front", size: 0.2, trunk: 0.17, tint: "green", haze: 0 },
    { fx: 0.96, ground: "front", size: 0.17, trunk: 0.15, tint: "autumn", haze: 0 }
  ];
  trees = specs.map((spec, index) => {
    const x = spec.fx * aspect;
    const top = spec.ground === "front" ? frontTopAt(x) : meadowTopAt(x);
    const rootY = top + 0.012;
    const size = spec.size * treeScale, trunk = spec.trunk * treeScale;
    const crownY = rootY - trunk - size * 0.25;
    const tree = { ...spec, x, rootY, crownY, size, trunk, phase: index * 1.7 };
    const tint = treeTints[tree.tint], haze = tree.haze;

    const centerX = tree.x - size * 0.6, centerY = tree.rootY + 0.004;
    const radiusX = size * 1.5, radiusY = size * 0.13;
    const sLeft = Math.max(0, Math.floor((centerX - radiusX) / colUnit));
    const sRight = Math.min(cols - 1, Math.ceil((centerX + radiusX) / colUnit));
    const sTop = Math.max(0, Math.floor((centerY - radiusY) / rowUnit));
    const sBottom = Math.min(rows - 1, Math.ceil((centerY + radiusY) / rowUnit));
    for (let row = sTop; row <= sBottom; row++) {
      for (let col = sLeft; col <= sRight; col++) {
        const dx = (uxTable[col] - centerX) / radiusX;
        const dy = (uyTable[row] - centerY) / radiusY;
        const edge = dx * dx + dy * dy;
        const idx = row * cols + col;
        if (edge >= 1 || layerMap[idx] < 4) continue;
        const factor = 1 - 0.5 * (1 - edge);
        const p4 = idx * 4;
        baseColors[p4] *= factor; baseColors[p4 + 1] *= factor; baseColors[p4 + 2] *= factor;
      }
    }

    const trunkTop = tree.rootY - trunk;
    const left = Math.max(0, Math.floor((tree.x - size * 2.1) / colUnit));
    const right = Math.min(cols - 1, Math.ceil((tree.x + size * 2.1) / colUnit));
    const topRow = Math.max(0, Math.floor((tree.crownY - size * 1.8) / rowUnit));
    const bottomRow = Math.min(rows - 1, Math.ceil(tree.rootY / rowUnit));
    for (let row = topRow; row <= bottomRow; row++) {
      const uy = uyTable[row];
      for (let col = left; col <= right; col++) {
        const ux = uxTable[col];
        const idx = row * cols + col;
        let nearest = 9, nearX = 0, nearY = 0;
        for (let i = 0; i < crownBlobs.length; i++) {
          const blob = crownBlobs[i];
          const dx = ux - (tree.x + blob[0] * size);
          const dy = uy - (tree.crownY + blob[1] * size);
          const radius = blob[2] * size;
          const distance = Math.sqrt(dx * dx + dy * dy) / radius;
          if (distance < nearest) { nearest = distance; nearX = dx / radius; nearY = dy / radius; }
        }
        const leafNoise = fractal(ux * 26, uy * 26, 2);
        if (nearest + (leafNoise - 0.5) * 0.55 < 1) {
          const facing = clamp(0.5 + 0.5 * (nearX * 0.55 - nearY * 0.75), 0, 1);
          const shade = clamp((0.2 + 0.8 * facing) * (0.7 + 0.6 * leafNoise), 0, 1);
          let color = mixColor(tint.dark, tint.light, shade);
          if (leafNoise > 0.72 && facing > 0.55) color = mixColor(color, [255, 246, 150], 0.35);
          if (haze > 0) color = mixColor(color, hazeColor, haze);
          baseColors[idx * 4] = color[0]; baseColors[idx * 4 + 1] = color[1]; baseColors[idx * 4 + 2] = color[2];
          baseChars[idx] = densityGlyph(color, 0.22 + (leafNoise - 0.5) * 0.4);
          treeMask[idx] = 1;
        } else if (uy >= trunkTop && uy <= tree.rootY) {
          const height = (tree.rootY - uy) / trunk;
          const half = size * (0.06 + 0.14 * Math.exp(-(tree.rootY - uy) / (size * 0.1))) * (1 - 0.3 * height);
          const offset = (ux - tree.x) / half;
          if (Math.abs(offset) < 1) {
            const light = clamp(0.45 + offset * 0.4 + (hash(col, 3) - 0.5) * 0.5, 0, 1);
            let color = mixColor([40, 28, 20], [138, 98, 62], light);
            if (haze > 0) color = mixColor(color, hazeColor, haze);
            baseColors[idx * 4] = color[0]; baseColors[idx * 4 + 1] = color[1]; baseColors[idx * 4 + 2] = color[2];
            baseChars[idx] = densityGlyph(color, 0.15);
            treeMask[idx] = 1;
          }
        }
      }
    }
    return tree;
  });
  leafTrees = trees.filter((tree) => tree.size > 0.12 * treeScale);
}

/* ---------- rabbits (compact sprites on phones) ---------- */
const RABBIT_SIT_R = [
  "      / /",
  "      / /",
  "     (e )",
  "  @@@@@@",
  " *@@@@@@",
  "  @@  @@"
];
const RABBIT_LEAP_R = [
  "      / /",
  "      / /",
  "     (e )",
  "  @@@@@@@",
  " *@@@@@@@",
  "  /     \\"
];
const RABBIT_SIT_R_SMALL = [
  " / /",
  " (e)",
  "*@@@",
  " @ @"
];
const RABBIT_LEAP_R_SMALL = [
  " / /",
  " (e)",
  "*@@@@",
  " / \\"
];
function mirrorRows(rows) {
  return rows.map((row) => {
    let out = "";
    for (let i = row.length - 1; i >= 0; i--) {
      const ch = row[i];
      out += ch === "/" ? "\\" : ch === "\\" ? "/" : ch === "(" ? ")" : ch === ")" ? "(" : ch;
    }
    return out;
  });
}
const RABBIT_SIT_L = mirrorRows(RABBIT_SIT_R);
const RABBIT_LEAP_L = mirrorRows(RABBIT_LEAP_R);
const RABBIT_SIT_L_SMALL = mirrorRows(RABBIT_SIT_R_SMALL);
const RABBIT_LEAP_L_SMALL = mirrorRows(RABBIT_LEAP_R_SMALL);

function makeRabbits() {
  rabbits = [];
  const coats = [
    [238, 238, 238], [186, 168, 148], [128, 116, 104],
    [214, 196, 170], [150, 140, 132], [246, 244, 238]
  ];
  const count = isPhone ? 4 : 6;
  const ys = isPhone ? [0.78, 0.84, 0.90, 0.95] : [0.72, 0.77, 0.83, 0.88, 0.92, 0.95];
  for (let i = 0; i < count; i++) {
    const y = ys[i];
    rabbits.push({
      x: aspect * (0.12 + 0.15 * i) + random() * 0.08,
      y,
      dir: random() < 0.5 ? -1 : 1,
      speed: 0.035 + random() * 0.03,
      hopRate: 1.6 + random() * 1.4,
      phase: random() * 6.28,
      color: coats[i],
      haze: clamp((0.95 - y) / 0.25, 0, 1) * 0.35
    });
  }
}

function updateRabbits(dt, time) {
  for (const r of rabbits) {
    const hop = Math.abs(fastSin(time * r.hopRate + r.phase));
    r.x += r.speed * r.dir * dt * (0.4 + hop);
    if (r.x < 0.06) { r.x = 0.06; r.dir = 1; }
    if (r.x > aspect - 0.06) { r.x = aspect - 0.06; r.dir = -1; }
    if (random() < 0.004) r.dir *= -1;
  }
}

function plotRabbit(col, row, color, glyph) {
  if (col < 0 || col >= cols || row < 0 || row >= rows) return;
  const idx = row * cols + col;
  if (layerMap[idx] < 3 || treeMask[idx]) return;
  const p = idx * 4;
  frameColors[p] = color[0]; frameColors[p + 1] = color[1]; frameColors[p + 2] = color[2];
  frameChars[idx] = glyph;
}

function rabbitColor(ch, coat, haze) {
  let c = ch === "*" ? [246, 246, 246] : ch === "e" ? [24, 20, 18] : coat;
  if (haze > 0) c = mixColor(c, hazeColor, haze);
  return c;
}
function rabbitGlyph(ch) {
  if (ch === "e") return gDot;
  if (ch === "*") return starGlyph;
  return glyphs.indexOf(ch);
}

function paintRabbit(r, time) {
  const hop = Math.abs(fastSin(time * r.hopRate + r.phase));
  const airborne = hop > 0.45;
  let pose;
  if (isPhone) {
    pose = airborne
      ? (r.dir > 0 ? RABBIT_LEAP_R_SMALL : RABBIT_LEAP_L_SMALL)
      : (r.dir > 0 ? RABBIT_SIT_R_SMALL : RABBIT_SIT_L_SMALL);
  } else {
    pose = airborne
      ? (r.dir > 0 ? RABBIT_LEAP_R : RABBIT_LEAP_L)
      : (r.dir > 0 ? RABBIT_SIT_R : RABBIT_SIT_L);
  }
  const lift = Math.round(hop * (isPhone ? 1.4 : 2.4));
  const c = Math.round(r.x / colUnit);
  const groundRow = Math.round(r.y / rowUnit);
  const h = pose.length, w = pose[0].length;
  const ox = c - (w >> 1), oy = groundRow - lift - h + 1;
  for (let y = 0; y < h; y++) {
    const row = pose[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === " ") continue;
      plotRabbit(ox + x, oy + y, rabbitColor(ch, r.color, r.haze), rabbitGlyph(ch));
    }
  }
}

function paintRabbits(time) {
  for (const r of rabbits) paintRabbit(r, time);
}

/* ---------- leaves ---------- */
function spawnLeaf() {
  const tree = leafTrees[Math.floor(random() * leafTrees.length)];
  leaves.push({
    x: tree.x + (random() - 0.5) * tree.size * 2.4,
    y: tree.crownY + (random() - 0.3) * tree.size * 1.2,
    speed: 0.02 + random() * 0.03,
    phase: random() * 6.28,
    glyph: glyphs.indexOf(leafGlyphs[Math.floor(random() * leafGlyphs.length)]),
    color: leafColors[Math.floor(random() * leafColors.length)]
  });
}
function updateLeaves(dt, time) {
  const cap = isPhone ? 50 : 120;
  if (leafTrees.length && leaves.length < cap && random() < dt * 30) spawnLeaf();
  leaves = leaves.filter((leaf) => {
    leaf.y += leaf.speed * dt;
    leaf.x += (0.03 + fastSin(time * 1.8 + leaf.phase) * 0.05) * dt;
    return leaf.y < frontTopAt(leaf.x) + 0.06;
  });
}
function paintLeaves() {
  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i];
    const col = (leaf.x / colUnit) | 0;
    const row = (leaf.y / rowUnit) | 0;
    if (col >= 0 && col < cols && row >= 0 && row < rows) {
      const index = row * cols + col, p = index * 4;
      frameColors[p] = leaf.color[0]; frameColors[p + 1] = leaf.color[1]; frameColors[p + 2] = leaf.color[2];
      frameChars[index] = leaf.glyph;
    }
  }
}

/* ---------- glyph atlas ---------- */
const atlasCanvas = document.createElement("canvas");
const atlasContext = atlasCanvas.getContext("2d");
function buildAtlas() {
  atlasCanvas.width = glyphs.length * cellWidth;
  atlasCanvas.height = cellHeight;
  atlasContext.font = "bold " + Math.round(cellWidth / 0.6) + "px monospace";
  atlasContext.fillStyle = "#ffffff";
  atlasContext.textAlign = "center";
  atlasContext.textBaseline = "middle";
  for (let i = 0; i < glyphs.length; i++) {
    atlasContext.fillText(glyphs[i], i * cellWidth + cellWidth / 2, cellHeight / 2 + 1);
  }
}

/* ---------- WebGL renderer ---------- */
let gl = null, glReady = false, cellsTex, atlasTex;
const uLoc = {};

const VERT = "attribute vec2 aPos;void main(){gl_Position=vec4(aPos,0.,1.);}";
const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uCells;
uniform sampler2D uAtlas;
uniform vec2 uGrid;
uniform vec2 uCell;
uniform vec2 uCanvas;
uniform float uGlyphCount;

vec3 cellRGB(vec2 c){ return texture2D(uCells,(c+0.5)/uGrid).rgb; }

void main(){
  vec2 px = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y);
  vec2 g = px / uCell;
  vec2 cell = floor(g);
  vec4 data = texture2D(uCells,(cell+0.5)/uGrid);
  float gi = floor(data.a*255.0+0.5);
  vec2 sub = g - cell;
  float a = texture2D(uAtlas, vec2((gi+sub.x)/uGlyphCount, sub.y)).a;

  vec2 ug = g - 0.5;
  vec2 c0 = floor(ug);
  vec2 f = ug - c0;
  vec3 under = mix(mix(cellRGB(c0), cellRGB(c0+vec2(1.,0.)), f.x),
                   mix(cellRGB(c0+vec2(0.,1.)), cellRGB(c0+vec2(1.,1.)), f.x), f.y);

  vec3 bg = vec3(0.0156863,0.0274510,0.0509804)*0.12 + under*0.88;
  vec3 ink = min(data.rgb*1.3 + 0.0549020, 1.0);
  gl_FragColor = vec4(mix(bg, ink, a), 1.0);
}`;

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function makeTex() {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
function initGL() {
  gl = canvas.getContext("webgl", {
    alpha: false, antialias: false, depth: false, stencil: false,
    powerPreference: "low-power", preserveDrawingBuffer: false
  });
  if (!gl) return false;
  try {
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    for (const n of ["uCells", "uAtlas", "uGrid", "uCell", "uCanvas", "uGlyphCount"])
      uLoc[n] = gl.getUniformLocation(prog, n);
    gl.uniform1i(uLoc.uCells, 0);
    gl.uniform1i(uLoc.uAtlas, 1);
    cellsTex = makeTex();
    atlasTex = makeTex();
    return true;
  } catch (e) { console.warn("WebGL init failed:", e); return false; }
}
function uploadGLSizes() {
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.uniform2f(uLoc.uGrid, cols, rows);
  gl.uniform2f(uLoc.uCell, cellWidth, cellHeight);
  gl.uniform2f(uLoc.uCanvas, canvas.width, canvas.height);
  gl.uniform1f(uLoc.uGlyphCount, glyphs.length);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, cellsTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, atlasTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlasCanvas);
}
function drawGL() {
  const total = cols * rows;
  for (let i = 0, p = 3; i < total; i++, p += 4) frameU8[p] = frameChars[i];
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, cellsTex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RGBA, gl.UNSIGNED_BYTE, frameU8);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); glReady = false; });
canvas.addEventListener("webglcontextrestored", () => {
  glReady = initGL();
  if (glReady) { uploadGLSizes(); drawGL(); }
});

/* ---------- static fallback ---------- */
function renderFallbackStatic() {
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return;
  const total = cols * rows;
  const under = document.createElement("canvas"); under.width = cols; under.height = rows;
  const img = new ImageData(cols, rows), gimg = new ImageData(cols, rows);
  for (let i = 0; i < total * 4; i += 4) {
    img.data[i] = frameColors[i];
    img.data[i + 1] = frameColors[i + 1];
    img.data[i + 2] = frameColors[i + 2];
    img.data[i + 3] = 255;
    gimg.data[i] = frameColors[i] * 1.3 + 14;
    gimg.data[i + 1] = frameColors[i + 1] * 1.3 + 14;
    gimg.data[i + 2] = frameColors[i + 2] * 1.3 + 14;
    gimg.data[i + 3] = 255;
  }
  under.getContext("2d").putImageData(img, 0, 0);
  const gc = document.createElement("canvas"); gc.width = cols; gc.height = rows;
  gc.getContext("2d").putImageData(gimg, 0, 0);
  const mask = document.createElement("canvas");
  mask.width = cols * cellWidth; mask.height = rows * cellHeight;
  const mctx = mask.getContext("2d");
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++) {
      const g = frameChars[row * cols + col];
      if (!g) continue;
      mctx.drawImage(atlasCanvas, g * cellWidth, 0, cellWidth, cellHeight,
        col * cellWidth, row * cellHeight, cellWidth, cellHeight);
    }
  mctx.globalCompositeOperation = "source-in";
  mctx.imageSmoothingEnabled = false;
  mctx.drawImage(gc, 0, 0, cols, rows, 0, 0, mask.width, mask.height);
  ctx.fillStyle = "#04070d"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 0.88;
  ctx.drawImage(under, 0, 0, cols, rows, 0, 0, mask.width, mask.height);
  ctx.globalAlpha = 1;
  ctx.drawImage(mask, 0, 0);
}

/* ---------- per-frame step ---------- */
function stepFrame() {
  timeSec += 1 / FPS;
  frameColors.set(baseColors);
  frameChars.set(baseChars);
  paintClouds(timeSec);
  paintShadows(timeSec);
  paintWind(timeSec);
  updateRabbits(1 / FPS, timeSec);
  paintRabbits(timeSec);
  updateLeaves(1 / FPS, timeSec);
  paintLeaves();
  if (glReady) drawGL();
}

/* ---------- setup / lifecycle ---------- */
let builtW = 0, builtH = 0;
function setupScene() {
  const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
  const w = Math.floor(window.innerWidth * ratio);
  const h = Math.floor(window.innerHeight * ratio);
  if (w === builtW && h === builtH) return;
  builtW = w; builtH = h;
  canvas.width = w; canvas.height = h;

  // phones: finer, smaller, less-dense grid; desktop unchanged
  isPhone = window.innerWidth < 700;
  const cssCell = isPhone
    ? Math.max(3, Math.round(window.innerWidth / 150))
    : Math.max(6, Math.round(window.innerWidth / targetColumns));
  cellWidth = Math.round(cssCell * ratio);
  cellHeight = Math.round(cssCell * 1.65 * ratio);
  cols = Math.ceil(w / cellWidth); rows = Math.ceil(h / cellHeight);
  aspect = w / h; colUnit = cellWidth / h; rowUnit = cellHeight / h;
  treeScale = isPhone ? clamp(aspect / 1.9, 0.35, 1) : 1;

  uxTable = new Float32Array(cols); uyTable = new Float32Array(rows);
  for (let col = 0; col < cols; col++) uxTable[col] = (col + 0.5) * colUnit;
  for (let row = 0; row < rows; row++) uyTable[row] = (row + 0.5) * rowUnit;
  sun = { x: aspect * 0.78, y: 0.25 };

  const total = cols * rows;
  frameColors = new Uint8ClampedArray(total * 4);
  frameU8 = new Uint8Array(frameColors.buffer);
  frameChars = new Uint8Array(total);

  buildAtlas();
  buildTerrain();
  buildScene();
  makeTrees();
  buildCloudCache();
  buildShadowCache();
  makeRabbits();
  seed = 12345; leaves = [];

  if (glReady) uploadGLSizes();
  stepFrame();
  if (!glReady) renderFallbackStatic();
}

function animate(ts) {
  rafId = requestAnimationFrame(animate);
  const elapsed = ts - lastFrame;
  if (elapsed < frameDelay) return;
  lastFrame = ts - (elapsed % frameDelay);
  stepFrame();
}
function start() { if (!rafId) rafId = requestAnimationFrame(animate); }
function stop() { cancelAnimationFrame(rafId); rafId = 0; }

let resizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(setupScene, 200);
});
document.addEventListener("visibilitychange", () => {
  if (!glReady) return;
  if (document.hidden) stop();
  else { lastFrame = performance.now(); start(); }
});

/* ---------- foreground toggle ---------- */
function initForegroundToggle() {
  const style = document.createElement("style");
  style.textContent = `
    body > * { transition: opacity .35s ease, visibility .35s ease; }
    .fg-hidden { opacity: 0 !important; visibility: hidden !important; pointer-events: none !important; }
    #bgToggle {
      position: fixed; top: 14px; left: 14px; z-index: 2147483647;
      font: 600 12px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      letter-spacing: .08em; color: #b8f0a0;
      background: rgba(8, 20, 12, .78); border: 1px solid rgba(140, 220, 120, .55);
      border-radius: 8px; padding: 10px 13px; cursor: pointer;
      backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
      box-shadow: 0 2px 12px rgba(0, 0, 0, .4);
    }
    #bgToggle:hover { background: rgba(22, 44, 26, .9); border-color: rgba(170, 240, 150, .9); }
    #bgToggle:focus-visible { outline: 2px solid #9fe08a; outline-offset: 2px; }
  `;
  document.head.appendChild(style);

  const btn = document.createElement("button");
  btn.id = "bgToggle";
  btn.type = "button";
  btn.textContent = "hide site";
  btn.setAttribute("aria-pressed", "false");
  btn.setAttribute("aria-label", "Toggle foreground content");
  document.body.appendChild(btn);

  const targets = [...document.body.children].filter(
    (el) => el !== canvas && el !== btn && !el.contains(canvas)
  );

  let on = false;
  btn.addEventListener("click", () => {
    on = !on;
    for (const el of targets) el.classList.toggle("fg-hidden", on);
    btn.setAttribute("aria-pressed", String(on));
    btn.textContent = on ? "show site" : "hide site";
  });
}

glReady = initGL();
setupScene();
initForegroundToggle();
if (glReady) start();
