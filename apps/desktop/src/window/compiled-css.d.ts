// CSS that @mux-factory/ui's compiledCss plugin compiles at build time, imported as a string.
declare module "*.css?compiled" {
  const css: string;
  export default css;
}
