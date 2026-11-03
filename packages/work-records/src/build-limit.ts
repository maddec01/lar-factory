// Build limit: how many builds may work at once on this machine. Automatic follows the heavy command limit.

import { limitSetting } from './limit-setting.ts';

export const buildLimitSetting = limitSetting('build-limit.json', 'build limit');
