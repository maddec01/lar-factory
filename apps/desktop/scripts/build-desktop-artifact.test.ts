import { describe, expect, it } from '@effect/vitest';
import * as NodeFS from 'node:fs';
import * as NodePath from 'node:path';

import { locateCommand } from '../src/lar-work/lar-work-launcher.ts';
import { larWorkPack } from '../vite.config.ts';
import { createBuildConfig } from './build-desktop-artifact.ts';

describe('createBuildConfig', () => {
    it("points a Nightly at the nightly channel of lar-factory's prereleases", () => {
        const config = createBuildConfig({
            version: '0.1.0-nightly.20261023.57',
            signed: false,
            outputDir: '/out',
        });

        expect(config.publish).toEqual([
            {
                provider: 'github',
                owner: 'maddec01',
                repo: 'lar-factory',
                releaseType: 'prerelease',
                channel: 'nightly',
            },
        ]);
    });

    it("points a Stable Release at lar-factory's latest releases", () => {
        const config = createBuildConfig({ version: '0.1.0', signed: false, outputDir: '/out' });

        expect(config.publish).toEqual([
            { provider: 'github', owner: 'maddec01', repo: 'lar-factory', releaseType: 'release' },
        ]);
    });

    it('ships the lar-work command built from packages/work-records outside app.asar, where its launcher runs it', () => {
        const config = createBuildConfig({ version: '0.1.0', signed: false, outputDir: '/out' });

        expect(larWorkPack.entry).toEqual({ 'lar-work': '../../packages/work-records/src/cli.ts' });
        expect(NodeFS.existsSync(NodePath.join(import.meta.dirname, '..', larWorkPack.entry['lar-work']))).toBe(true);
        expect(config.extraResources).toContainEqual({ from: larWorkPack.outDir, to: 'work-records' });
        expect(config.files).toContain(`!${larWorkPack.outDir}/**/*`);
        // Packaged, Electron's app path is Resources/app.asar.
        expect(locateCommand('/App/Contents/Resources/app.asar', true)).toBe(
            '/App/Contents/Resources/work-records/lar-work.mjs',
        );
    });

    it('signs with hardened runtime and notarizes when signed', () => {
        const mac = createBuildConfig({ version: '0.1.0', signed: true, outputDir: '/out' }).mac;

        expect(mac).not.toHaveProperty('identity');
        expect(mac?.hardenedRuntime).toBe(true);
        expect(mac?.notarize).toBe(true);
        expect(mac?.sign).toMatch(/scripts\/sign-macos\.ts$/);
    });
});
