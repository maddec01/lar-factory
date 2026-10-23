// Which links leave the window for the browser: web links only. Any other scheme (file:,
// a custom app handler, javascript:) or a URL that doesn't parse opens nothing.

/** `target` as a URL to open in the browser, or undefined when it isn't an http(s) URL. */
export const browserUrl = (target: string): string | undefined => {
  const url = URL.parse(target);
  return url?.protocol === "https:" || url?.protocol === "http:" ? url.href : undefined;
};

/** Whether `target` is a page of `origin`, which stays in the window. */
export const isOn = (target: string, origin: string): boolean => URL.parse(target)?.origin === origin;
