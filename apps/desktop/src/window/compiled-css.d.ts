// CSS that the compiledCss plugin (scripts/compiled-css.ts) compiles at build time, imported as a string.
declare module '*.css?compiled' {
    const css: string;
    export default css;
}
