// Registers every world beyond the river canyon (imported once by main.js).
import { registerWorld } from './index.js';
import { createArena } from './arena.js';
import { createDesert } from './desert.js';
import { createOrbit } from './orbit.js';
import { createCity } from './city.js';

registerWorld('arena', createArena);
registerWorld('desert', createDesert);
registerWorld('orbit', createOrbit);
registerWorld('city', createCity);
