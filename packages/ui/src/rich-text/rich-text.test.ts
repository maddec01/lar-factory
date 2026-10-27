import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vite-plus/test';
import { RichText } from './rich-text.tsx';

const render = (text: string, format: 'markdown' | 'html') => renderToStaticMarkup(createElement(RichText, { text, format }));
const markdown = (text: string) => render(text, 'markdown');
const html = (text: string) => render(text, 'html');

describe('GitHub-flavoured markdown', () => {
  test('headings, emphasis, lists and links', () => {
    const out = markdown('# Title\n\nSome **bold** and _italic_ text.\n\n- one\n- two\n\n1. first\n2. second\n\n[docs](https://example.com/docs)');
    expect(out).toMatch(/<h1>Title<\/h1>/);
    expect(out).toMatch(/<strong>bold<\/strong>/);
    expect(out).toMatch(/<em>italic<\/em>/);
    expect(out).toMatch(/<ul>\s*<li>one<\/li>\s*<li>two<\/li>\s*<\/ul>/);
    expect(out).toMatch(/<ol>\s*<li>first<\/li>\s*<li>second<\/li>\s*<\/ol>/);
    expect(out).toMatch(/<a [^>]*href="https:\/\/example.com\/docs"[^>]*>docs<\/a>/);
  });

  test('fenced and inline code', () => {
    const out = markdown('```ts\nconst a = 1;\n```\n\nUse `pnpm test`.');
    expect(out).toMatch(/<pre[^>]*><code[^>]*>const a = 1;\n<\/code><\/pre>/);
    expect(out).toMatch(/<code>pnpm test<\/code>/);
  });

  test('tables', () => {
    const out = markdown('| a | b |\n| - | - |\n| 1 | 2 |');
    expect(out).toMatch(/<table>/);
    expect(out).toMatch(/<th>a<\/th>/);
    expect(out).toMatch(/<td>2<\/td>/);
  });

  test('task lists', () => {
    const out = markdown('- [x] done\n- [ ] todo');
    expect(out.match(/<input type="checkbox" disabled=""( checked="")?\/>/g)).toHaveLength(2);
    expect(out).toMatch(/<input [^>]*checked=""[^>]*\/> done/);
    expect(out).toMatch(/<input type="checkbox" disabled=""\/> todo/);
  });

  test('strikethrough and autolinked URLs', () => {
    const out = markdown('~~gone~~ see https://example.com/x');
    expect(out).toMatch(/<del>gone<\/del>/);
    expect(out).toMatch(/<a [^>]*href="https:\/\/example.com\/x"/);
  });
});

describe('raw HTML', () => {
  test('<details> and <summary> survive in markdown', () => {
    const out = markdown('<details>\n<summary>More</summary>\n\nHidden **text**\n\n</details>');
    expect(out).toMatch(/<details>/);
    expect(out).toMatch(/<summary>More<\/summary>/);
    expect(out).toMatch(/<strong>text<\/strong>/);
  });

  test('<details> survives in html', () => {
    expect(html('<details><summary>More</summary><p>Hidden</p></details>')).toMatch(/<details><summary>More<\/summary><p>Hidden<\/p><\/details>/);
  });

  test('html format keeps the usual tags', () => {
    const out = html('<div>Hello <b>there</b></div><ul><li>a</li></ul><table><tbody><tr><td>c</td></tr></tbody></table>');
    expect(out).toMatch(/<b>there<\/b>/);
    expect(out).toMatch(/<ul><li>a<\/li><\/ul>/);
    expect(out).toMatch(/<td>c<\/td>/);
  });

  test('html is not read as markdown', () => {
    const out = html('<p>* not a list\n# not a heading</p>');
    expect(out).not.toMatch(/<li>|<h1>/);
  });
});

describe('sanitizing', () => {
  const inputs = {
    'a script tag': '<script>alert(1)</script>after',
    'an event handler': '<p onclick="alert(1)" onmouseover="alert(2)">hi</p>',
    'a javascript: link': '<a href="javascript:alert(1)">x</a>',
    'an iframe': '<iframe src="https://evil.example"></iframe>',
    'a style attribute': '<p style="position:fixed">hi</p>',
    'a style tag': '<style>body{display:none}</style>hi',
  };
  for (const [name, input] of Object.entries(inputs)) {
    for (const [format, run] of [['markdown', markdown], ['html', html]] as const) {
      test(`${format} drops ${name}`, () => {
        const out = run(input);
        expect(out).not.toMatch(/<script|<iframe|<style|onclick|onmouseover|javascript:|position:fixed|display:none|alert\(/i);
      });
    }
  }

  test('a markdown javascript: link loses its href', () => {
    expect(markdown('[x](javascript:alert(1))')).not.toMatch(/javascript:/);
  });

  test('a javascript: image becomes plain text, not a link', () => {
    const out = markdown('![bad](javascript:alert(1))');
    expect(out).not.toMatch(/javascript:|<img/);
    expect(out).toMatch(/bad/);
  });

  test('text outside the tags stays', () => {
    expect(html('<script>x</script>after')).toMatch(/after/);
  });
});

describe('images', () => {
  test('a markdown image becomes a link with its alt text, opening in a new tab', () => {
    const out = markdown('![a diagram](https://example.com/d.png)');
    expect(out).not.toMatch(/<img/);
    expect(out).toMatch(/<a [^>]*href="https:\/\/example.com\/d.png"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*>a diagram<\/a>/);
  });

  test('an html image becomes a link too', () => {
    const out = html('<p><img src="https://example.com/d.png" alt="shot"></p>');
    expect(out).not.toMatch(/<img/);
    expect(out).toMatch(/<a [^>]*href="https:\/\/example.com\/d.png"[^>]*target="_blank"[^>]*>shot<\/a>/);
  });

  test('raw html in markdown becomes a link', () => {
    const out = markdown('<img src="https://example.com/d.png" alt="raw">');
    expect(out).not.toMatch(/<img/);
    expect(out).toMatch(/<a [^>]*href="https:\/\/example.com\/d.png"[^>]*>raw<\/a>/);
  });

  test('an empty alt shows the URL as the link text', () => {
    expect(markdown('![](https://example.com/d.png)')).toMatch(/>https:\/\/example.com\/d.png<\/a>/);
    expect(html('<img src="https://example.com/e.png">')).toMatch(/>https:\/\/example.com\/e.png<\/a>/);
  });

  test('an image inside a link does not nest links', () => {
    const out = markdown('[![alt text](https://example.com/i.png)](https://example.com/page)');
    expect(out.match(/<a /g)?.length).toBe(1);
    expect(out).toMatch(/href="https:\/\/example.com\/page"/);
    expect(out).toMatch(/alt text/);
  });
});

describe('links', () => {
  test('open in a new tab with rel, in markdown and html', () => {
    for (const out of [markdown('[x](https://example.com)'), html('<a href="https://example.com">x</a>'), markdown('<a href="https://example.com">x</a>')]) {
      expect(out).toMatch(/<a [^>]*target="_blank"/);
      expect(out).toMatch(/<a [^>]*rel="noopener noreferrer"/);
    }
  });
});

describe('layout', () => {
  test('an empty string renders nothing', () => {
    expect(markdown('')).toBe('');
    expect(html('')).toBe('');
  });

  test('the container wraps long words, code and tables so nothing scrolls sideways', () => {
    const out = markdown('x');
    expect(out).toMatch(/^<div [^>]*class="[^"]*\bmin-w-0\b[^"]*\bmax-w-full\b[^"]*"/);
    expect(out).toMatch(/break-words/);
    expect(out).toMatch(/\[&amp;_pre\]:whitespace-pre-wrap/);
    expect(out).toMatch(/\[&amp;_table\]:table-fixed/);
  });
});
