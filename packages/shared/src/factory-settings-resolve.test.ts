import { expect, it } from 'vite-plus/test';

import { resolveFactorySettings } from './factory-settings-resolve.ts';
import { defaultFactorySettings } from './factory-settings.ts';

it('resolves the supporting shaping and build roles independently', () => {
    const settings = defaultFactorySettings();

    settings.threadKinds.build = { effort: 'high' };
    for (const role of ['explore', 'diagnose', 'research', 'prototype', 'checks', 'domain-docs', 'fixer'] as const) {
        settings.roles[role] = { effort: 'low' };
        expect(resolveFactorySettings(settings, 'build', role).effort).toBe('low');
        delete settings.roles[role];
        expect(resolveFactorySettings(settings, 'build', role).effort).toBe('high');
    }
});
