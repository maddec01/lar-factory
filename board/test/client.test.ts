import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const client = readFileSync(new URL('../src/client.ts', import.meta.url), 'utf8');

/** The page's click handler: the selector it picks a target with, and the code that branches on it. */
function clickHandler(): { selector: string; body: string } {
  const start = client.indexOf("app.addEventListener('click'");
  const body = client.slice(start, client.indexOf('\n});', start));
  const selector = body.match(/closest<HTMLElement>\('([^']+)'\)/)?.[1];
  assert.ok(selector, 'the click handler picks its target with closest()');
  return { selector, body };
}

test('every button the click handler acts on is one its selector reaches, so Recheck posts to /api/recheck', () => {
  const { selector, body } = clickHandler();
  const reached = new Set(selector.split(',').map((s) => s.replace(/^\[|\]$/g, '')));
  const kebab = (name: string) => `data-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
  const handled = [
    ...[...body.matchAll(/target\.dataset\.(\w+)/g)].map((m) => kebab(m[1]!)),
    ...[...body.matchAll(/target\.hasAttribute\('([\w-]+)'\)/g)].map((m) => m[1]!),
  ];
  assert.ok(handled.includes('data-recheck'));
  for (const attribute of handled) assert.ok(reached.has(attribute), `${attribute} is handled but never clicked`);
  assert.match(body, /void recheck\(\)/);
  assert.match(client, /postAction\('\/api\/recheck'/);
});
