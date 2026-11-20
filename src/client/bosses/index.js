// Boss per mission key.
import { Warden } from './warden.js';
import { Borer } from './borer.js';
import { Frigate } from './frigate.js';
import { Arachnid } from './arachnid.js';

const BOSSES = { river: Warden, desert: Borer, orbit: Frigate, city: Arachnid };

export function createBoss(key, stage, def) {
    const Type = BOSSES[key] ?? Warden;
    return new Type(stage, def);
}
