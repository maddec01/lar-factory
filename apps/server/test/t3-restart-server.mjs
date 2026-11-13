// Isolated T3 transport fixture: only project reads, tickets and a shell snapshot.
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

const token = `fixture-${process.pid}`;
const project = { id: 'fixture', title: 'Fixture', workspaceRoot: '/fixture' };
const server = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
        res.writeHead(401).end();

        return;
    }

    res.setHeader('Content-Type', 'application/json');
    res.end(
        JSON.stringify(
            req.url === '/api/projects'
                ? { projects: [project], updatedAt: new Date().toISOString() }
                : { ticket: token },
        ),
    );
});

server.on('upgrade', (req, socket) => {
    if (new URL(req.url, 'http://localhost').searchParams.get('wsTicket') !== token) {
        socket.destroy();

        return;
    }

    const accept = createHash('sha1')
        .update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64');

    socket.write(
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );

    const frame = Buffer.from(
        JSON.stringify({
            _tag: 'Chunk',
            requestId: '1',
            values: [{ kind: 'snapshot', snapshot: { snapshotSequence: 1, projects: [project] } }],
        }),
    );
    const header = Buffer.alloc(4);

    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(frame.length, 2);
    socket.write(Buffer.concat([header, frame]));
    socket.on('data', () => socket.write(Buffer.from([0x81, 15, ...Buffer.from('{"_tag":"Pong"}')])));
    socket.on('error', () => {});
});
server.listen(0, '127.0.0.1', () =>
    process.send({ origin: `http://127.0.0.1:${server.address().port}`, pid: process.pid, token }),
);
