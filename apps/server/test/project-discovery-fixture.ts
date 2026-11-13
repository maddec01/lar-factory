// Spawned board fixtures supply project observations at the discovery seam, and record launches at the launch seam.
import { registerHooks } from 'node:module';

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier.endsWith('/item-execution.ts') && !context.parentURL?.endsWith('/execution-observations.ts'))
            return { url: new URL('./execution-observations.ts', import.meta.url).href, shortCircuit: true };

        if (specifier.endsWith('/execution-capabilities.ts'))
            return { url: new URL('./run-model-observations.ts', import.meta.url).href, shortCircuit: true };

        if (specifier.endsWith('/launch-thread.ts'))
            return { url: new URL('./launch-observations.ts', import.meta.url).href, shortCircuit: true };

        if (specifier.endsWith('/repository-project-discovery.ts')) {
            return { url: new URL('./project-observations.ts', import.meta.url).href, shortCircuit: true };
        }

        return nextResolve(specifier, context);
    },
});
