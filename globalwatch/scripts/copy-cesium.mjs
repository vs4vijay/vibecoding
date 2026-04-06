/**
 * Copy Cesium static assets to public folder
 * This runs automatically after npm install / bun install
 */

import { cpSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const publicCesium = join(rootDir, 'public', 'cesium');
const cesiumBuild = join(rootDir, 'node_modules', 'cesium', 'Build', 'Cesium');

// Create public/cesium directory if it doesn't exist
if (!existsSync(publicCesium)) {
  mkdirSync(publicCesium, { recursive: true });
}

// Copy directories
const dirsToCopy = ['Assets', 'Workers', 'Widgets'];

for (const dir of dirsToCopy) {
  const src = join(cesiumBuild, dir);
  const dest = join(publicCesium, dir);
  
  console.log(`Copying Cesium ${dir}...`);
  try {
    cpSync(src, dest, { recursive: true, force: true });
    console.log(`✓ Copied ${dir}`);
  } catch (err) {
    console.error(`✗ Failed to copy ${dir}:`, err.message);
  }
}

console.log('Cesium assets copied successfully!');
