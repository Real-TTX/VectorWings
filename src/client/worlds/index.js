// World per mission key. Missing worlds fall back to the river canyon.
import { createRiver } from './river.js';

const WORLDS = { river: createRiver };

export function registerWorld(key, factory) {
    WORLDS[key] = factory;
}

export function createWorld(key, stage, context) {
    return (WORLDS[key] ?? WORLDS.river)(stage, context);
}
