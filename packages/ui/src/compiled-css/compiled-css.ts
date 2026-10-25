// A Vite and Rolldown plugin that compiles a CSS file with Tailwind at build time and imports it as a string,
// for pages that load no bundle, such as the board app's starting page. A file imported as `./page.css?compiled`
// can `@import "@lar-factory/ui/styles.css"` and `@apply` utilities; the import is the minified CSS.
import { compile, optimize } from '@tailwindcss/node';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const query = '?compiled';
// The id ends in .js so Vite's own CSS plugin leaves the module alone.
const prefix = '\0compiled-css:';
const suffix = '.js';

interface Context {
  addWatchFile(file: string): void;
}

export const compiledCss = () => ({
  name: 'lar-factory:compiled-css',
  enforce: 'pre' as const,
  resolveId(source: string, importer: string | undefined): string | undefined {
    if (!source.endsWith(query) || importer === undefined) return undefined;
    return prefix + resolve(dirname(importer), source.slice(0, -query.length)) + suffix;
  },
  async load(this: Context, id: string): Promise<string | undefined> {
    if (!id.startsWith(prefix)) return undefined;
    const file = id.slice(prefix.length, -suffix.length);
    this.addWatchFile(file);
    const compiler = await compile(await readFile(file, 'utf8'), {
      base: dirname(file),
      onDependency: (dependency) => this.addWatchFile(dependency),
    });
    const css = optimize(compiler.build([]), { file, minify: true }).code;
    return `export default ${JSON.stringify(css)};`;
  },
});
