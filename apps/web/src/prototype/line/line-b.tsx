// PROTOTYPE, throwaway. Line variant B: placeholder, a subagent fills it in.

import type { LineProps } from './line-data.ts';
import { LineCurrent } from './line-current.tsx';

export const NAME = 'Variant B (to build)';

export function LineB(props: LineProps) {
  return <LineCurrent {...props} />;
}
