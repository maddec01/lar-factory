// PROTOTYPE, throwaway. Line variant C: placeholder, a subagent fills it in.

import type { LineProps } from './line-data.ts';
import { LineCurrent } from './line-current.tsx';

export const NAME = 'Variant C (to build)';

export function LineC(props: LineProps) {
  return <LineCurrent {...props} />;
}
