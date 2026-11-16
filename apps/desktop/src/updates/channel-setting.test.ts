import { assert, describe, it } from '@effect/vitest';
import * as Effect from 'effect/Effect';
import * as NodePath from 'node:path';

import { tempDir } from '../../test/support.ts';
import * as ChannelSetting from './channel-setting.ts';

const tempFile = () => NodePath.join(tempDir('update-channel-'), 'settings', 'update-channel.json');

describe('ChannelSetting', () => {
    it.effect('reads nothing before a choice, then the channel last written', () =>
        Effect.gen(function* () {
            const file = tempFile();

            assert.isNull(yield* ChannelSetting.atFile(file).read);
            yield* ChannelSetting.atFile(file).write('nightly');
            assert.strictEqual(yield* ChannelSetting.atFile(file).read, 'nightly');
            yield* ChannelSetting.atFile(file).write('latest');
            assert.strictEqual(yield* ChannelSetting.atFile(file).read, 'latest');
        }),
    );
});
