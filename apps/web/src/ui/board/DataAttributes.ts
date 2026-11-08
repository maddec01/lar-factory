/** The `data-*` attributes a board composition passes on to its root element, which name what it shows for the
 *  board's tests and keyboard focus (such as `data-item` or `data-stage`). */
export type DataAttributes = { [name: `data-${string}`]: string | number | boolean | undefined };
