// Sprite atlas: enemies, weapon view-models, items, props and effects.

import { drawEnemyFrames } from './sprites/enemies.js';
import { drawWeaponFrames } from './sprites/weapons.js';
import { drawItemFrames } from './sprites/items.js';
import { packAtlas } from './sprites/pack.js';

// -> { atlas: { w, h, data /* RGBA, alpha 0 or 255 */ }, frames: { [name]: { x, y, w, h } } }
export function buildSprites() {
  return packAtlas({ ...drawEnemyFrames(), ...drawWeaponFrames(), ...drawItemFrames() });
}
