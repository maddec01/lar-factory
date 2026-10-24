// PROTOTYPE, throwaway. Line variant A: placeholder, a subagent fills it in.

import type { LineProps } from './line-data.ts';
import { LineCurrent } from './line-current.tsx';

export const NAME = 'Variant A (to build)';

export function LineA(props: LineProps) {
  return <LineCurrent {...props} />;
}
