// Which links leave the window: web links open in the browser and T3 Code thread links in T3 Code. Any other
// scheme (file:, another app's handler, javascript:), any other T3 Code route, or a URL that doesn't parse opens
// nothing.

const WEB = ["https:", "http:"];

/** A link the board makes to a T3 thread, `t3code://threads/<environment id>/<thread id>`, and no other T3 Code route. */
const isThreadLink = (url: URL): boolean => url.protocol === "t3code:" && url.host === "threads" && !url.username && !url.password;

/** `target` as a URL the system opens, or undefined when it isn't an http(s) URL or a T3 Code thread link. */
export const outsideUrl = (target: string): string | undefined => {
  const url = URL.parse(target);
  return url && (WEB.includes(url.protocol) || isThreadLink(url)) ? url.href : undefined;
};

/** Whether `target` is a page of `origin`, which stays in the window. */
export const isOn = (target: string, origin: string): boolean => URL.parse(target)?.origin === origin;
