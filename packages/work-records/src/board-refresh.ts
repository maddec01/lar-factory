// A phase write asks only boards sharing its data folder to read immediately.
import { boardDataDir } from '@lar-factory/shared/data-dir';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function refreshBoards(workId: string, dir = boardDataDir()): Promise<void> {
    const read = async (port: number) => {
        if (!Number.isInteger(port) || port < 1 || port > 65535) return;

        await fetch(`http://127.0.0.1:${port}/api/read`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${port}` },
            body: JSON.stringify({ workId }),
            redirect: 'error',
            signal: AbortSignal.timeout(1000),
        })
            .then((response) => response.body?.cancel())
            .catch(() => {});
    };

    if (/^\d+$/.test(process.env.LAR_BOARD_PORT ?? '')) return read(Number(process.env.LAR_BOARD_PORT));

    const folder = join(dir, 'boards');
    const files = await readdir(folder).catch(() => []);

    await Promise.all(
        files.map(async (file) => {
            if (!/^\d+\.json$/.test(file)) return;

            try {
                process.kill(Number(file.slice(0, -5)), 0);

                const { port } = JSON.parse(await readFile(join(folder, file), 'utf8'));

                await read(port);
            } catch {
                // A stale registry entry or an unavailable board cannot fail a phase write.
            }
        }),
    );
}
