import { assert, describe, it } from '@effect/vitest';

import * as LaunchSecret from '../board-server/launch-secret.ts';
import * as StartingPage from './starting-page.ts';

const html = (url: string) => decodeURIComponent(url.slice(url.indexOf(',') + 1));

describe('StartingPage messages', () => {
    // Runs a message in a stand-in for the page and returns what it called.
    const run = (script: string) => {
        const calls: Array<[string, string]> = [];

        // oxlint-disable-next-line typescript/no-implied-eval -- runs the starting page's own script in a stand-in window
        new Function('window', script)({
            larLoading: {
                step: (text: string) => calls.push(['step', text]),
                error: (text: string) => calls.push(['error', text]),
            },
        });

        return calls;
    };

    it("sends why a start failed as the page's error line, whatever characters the reason holds", () => {
        const reason = `the board server exited with code 1 <before> "it" reported a port `;

        assert.deepEqual(run(StartingPage.errorScript(reason)), [
            ['error', `The board server didn't start: ${reason}. Trying again.`],
        ]);
    });

    it('does nothing on a page that is not the starting page', () => {
        // oxlint-disable-next-line typescript/no-implied-eval -- runs the starting page's own script in a stand-in window
        assert.doesNotThrow(() => new Function('window', StartingPage.stepScript('x'))({}));
        // oxlint-disable-next-line typescript/no-implied-eval -- runs the starting page's own script in a stand-in window
        assert.doesNotThrow(() => new Function('window', StartingPage.errorScript('x'))({}));
    });
});

describe('StartingPage script', () => {
    // The least DOM the page's script touches, so the script itself runs.
    class Node {
        children: Node[] = [];
        className = '';
        hidden = false;
        textContent = '';
        parent?: Node;
        get lastElementChild() {
            return this.children.at(-1);
        }
        append(child: Node) {
            child.parent = this;
            this.children.push(child);
        }
        replaceChildren(...next: Node[]) {
            this.children = [];
            for (const child of next) this.append(child);
        }
        remove() {
            if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
        }
    }

    const open = (reduced = false) => {
        const nodes: Record<string, Node> = { slot: new Node(), step: new Node(), error: new Node() };

        nodes.error!.hidden = true;

        const first = new Node();

        first.textContent = StartingPage.STEPS.shell;
        nodes.slot!.append(first);

        const timers: Array<() => void> = [];
        const script = /<script>([\s\S]*)<\/script>/.exec(html(StartingPage.url()))![1]!;
        const window: { larLoading?: { step: (text: string) => void; error: (text: string) => void } } = {};

        // oxlint-disable-next-line typescript/no-implied-eval -- runs the starting page's own script in a stand-in window
        new Function('window', 'document', 'matchMedia', 'setTimeout', script)(
            window,
            { getElementById: (id: string) => nodes[id], createElement: () => new Node() },
            () => ({ matches: reduced }),
            (run: () => void) => timers.push(run),
        );

        const slot = () => nodes.slot!.children.map((child) => child.textContent);

        return { page: window.larLoading!, nodes, slot, timers };
    };

    it('rolls a new step in over the old one, which leaves when the roll ends', () => {
        const { page, slot, timers } = open();

        page.step(StartingPage.STEPS.server);
        assert.deepEqual(slot(), [StartingPage.STEPS.shell, StartingPage.STEPS.server]);
        timers.forEach((run) => run());
        assert.deepEqual(slot(), [StartingPage.STEPS.server]);
    });

    it('shows an error in place of the step line', () => {
        const { page, nodes } = open();

        page.error("The board server didn't start: x. Trying again.");
        assert.equal(nodes.error!.textContent, "The board server didn't start: x. Trying again.");
        assert.isFalse(nodes.error!.hidden);
        assert.isTrue(nodes.step!.hidden);
    });

    it("shows the step line again, and hides the error, when the retry's next step arrives", () => {
        const { page, nodes, slot } = open();

        page.error("The board server didn't start: x. Trying again.");
        page.step(StartingPage.STEPS.shell);
        assert.isFalse(nodes.step!.hidden, 'the same step as before the failure still shows the line');
        assert.isTrue(nodes.error!.hidden);
        page.error('again');
        page.step(StartingPage.STEPS.server);
        assert.isFalse(nodes.step!.hidden);
        assert.isTrue(nodes.error!.hidden);
        assert.include(slot(), StartingPage.STEPS.server);
    });
});

describe('StartingPage.drawWait', () => {
    it('is what is left of the 1.75 s draw since the page showed', () => {
        assert.equal(StartingPage.DRAW_MS, 1750);
        assert.equal(StartingPage.drawWait(10_000, 10_000), 1750);
        assert.equal(StartingPage.drawWait(10_000, 10_400), 1350);
        assert.equal(StartingPage.drawWait(10_000, 11_749), 1);
    });

    it('is nothing once the draw is done, or if the clock went back', () => {
        assert.equal(StartingPage.drawWait(10_000, 11_750), 0);
        assert.equal(StartingPage.drawWait(10_000, 60_000), 0);
    });
});

describe('StartingPage.boardUrl', () => {
    it('adds the flag that tells the board page the mark is drawn', () => {
        assert.equal(StartingPage.boardUrl(new URL('http://127.0.0.1:4317/')), 'http://127.0.0.1:4317/?loading=drawn');
    });

    it('keeps a URL the launch secret still goes to', () => {
        const secret = 's3cret';
        const href = StartingPage.boardUrl(new URL('http://127.0.0.1:4317/'));

        assert.equal(LaunchSecret.forFrame(href, 'http://127.0.0.1:4317', secret), secret);
    });
});
