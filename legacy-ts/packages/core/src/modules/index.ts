export * from './registry.js';
export * from './api.js';
export { nametagModule } from './builtin/nametag.js';
export { flexiModule } from './builtin/flexi.js';
export { storageBoxModule } from './builtin/box.js';
export { lampshadeModule, LAMP_FAMILIES, SOCKET_HOLE_RADIUS, familyInputs, type LampFamily } from './builtin/lamp.js';
export { reliefVaseModule, VASE_SHAPES, VASE_PATTERNS, RIB_STYLES, VASE_FONTS, VASE_PRINT_NOTES, parseProfileInput } from './builtin/vase.js';
import { ModuleRegistry } from './registry.js';
import { nametagModule } from './builtin/nametag.js';
import { flexiModule } from './builtin/flexi.js';
import { storageBoxModule } from './builtin/box.js';
import { lampshadeModule } from './builtin/lamp.js';
import { reliefVaseModule } from './builtin/vase.js';

/** Registry preloaded with the built-in modules. */
export function createDefaultRegistry(): ModuleRegistry {
  return new ModuleRegistry().register(nametagModule).register(flexiModule).register(storageBoxModule).register(lampshadeModule).register(reliefVaseModule);
}
