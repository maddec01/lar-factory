import { once } from 'node:events';
// Holds the renderer's origin while the supervised child changes ports.
import { createServer, request } from 'node:http';

export async function openBoardAddress() {
    let target: URL | undefined;
    const pending = new Set<ReturnType<typeof request>>();
    const server = createServer((incoming, outgoing) => {
        if (incoming.headers.host !== url.host) {
            outgoing.writeHead(421).end();

            return;
        }

        const current = target;

        if (!current) {
            outgoing.writeHead(503).end();

            return;
        }

        // Never turn an unrelated site's Origin into an authorized board write.
        const headers = { ...incoming.headers, host: current.host };

        if (headers.origin === url.origin) headers.origin = current.origin;

        const upstream = request(
            {
                hostname: current.hostname,
                port: current.port,
                path: incoming.url,
                method: incoming.method,
                headers,
            },
            (response) => {
                outgoing.writeHead(response.statusCode ?? 502, response.headers);
                response.pipe(outgoing);
                response.on('error', () => outgoing.destroy());
            },
        );

        pending.add(upstream);
        upstream.on('close', () => pending.delete(upstream));
        upstream.on('error', () => {
            if (!outgoing.headersSent) outgoing.writeHead(503).end();
            else outgoing.destroy();
        });
        outgoing.on('close', () => upstream.destroy());
        incoming.pipe(upstream);
    });

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');

    const address = server.address();

    if (!address || typeof address === 'string') throw new Error('Expected a board address');

    const url = new URL(`http://127.0.0.1:${address.port}`);
    const disconnect = () => {
        target = undefined;
        for (const upstream of pending) upstream.destroy();
    };

    return {
        url,
        connect: (next: URL) => {
            disconnect();
            target = next;
        },
        disconnect,
        close: () => {
            disconnect();
            server.closeAllConnections();
            server.close();
        },
    };
}
