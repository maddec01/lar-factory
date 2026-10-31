// Spawned board fixtures supply project observations at the discovery seam.
import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('/repository-project-discovery.ts')) {
      return { url: new URL('./project-observations.ts', import.meta.url).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
