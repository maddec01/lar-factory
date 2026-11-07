import { test } from '@lar-works/config';
import { defineConfig } from 'vite-plus';

export default defineConfig({
    test: {
        ...test,
        include: ['src/**/*.test.ts'],
    },
});
