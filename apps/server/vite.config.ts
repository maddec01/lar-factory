import { test } from '@lar-works/config';
import { join } from 'node:path';
import { defineConfig } from 'vite-plus';

const coverage = process.env.NODE_V8_COVERAGE || process.argv.some((arg) => arg.startsWith('--coverage'));

export default defineConfig({
    test: {
        ...test,
        // Reuse compiled code across real subprocess boots; keep precise V8 coverage uncached.
        env: coverage
            ? { NODE_DISABLE_COMPILE_CACHE: '1' }
            : { NODE_COMPILE_CACHE: join(import.meta.dirname, 'node_modules/.cache/node') },
        environment: 'node',
        include: ['src/**/*.test.ts', 'test/*.test.ts'],
        // The tests spawn the board, which can take many seconds in CI.
        testTimeout: 60_000,
    },
});
