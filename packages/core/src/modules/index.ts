export * from './registry.js';
export * from './api.js';
export { nametagModule } from './builtin/nametag.js';
export { flexiModule } from './builtin/flexi.js';
export { storageBoxModule } from './builtin/box.js';
import { ModuleRegistry } from './registry.js';
import { nametagModule } from './builtin/nametag.js';
import { flexiModule } from './builtin/flexi.js';
import { storageBoxModule } from './builtin/box.js';

/** Registry preloaded with the built-in modules. */
export function createDefaultRegistry(): ModuleRegistry {
  return new ModuleRegistry().register(nametagModule).register(flexiModule).register(storageBoxModule);
}
