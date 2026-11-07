// Every test file's setup: the browser APIs the design system's components use and jsdom lacks, and the design
// system's module-level state (its toasts) cleared after each test. src/test/PageTest.ts then mounts the page.

import { installDomStubs, resetDesignSystem } from '@lar-works/design-system/testing';
import { afterEach } from 'vite-plus/test';

installDomStubs();

afterEach(() => {
    resetDesignSystem();
});
