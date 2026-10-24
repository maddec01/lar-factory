// PROTOTYPE, throwaway. Sidebar variant A: placeholder, a subagent fills it in.

import type { SidebarProps } from './sidebar-data.ts';
import { SidebarCurrent } from './sidebar-current.tsx';

export const NAME = 'Variant A (to build)';

export function SidebarA(props: SidebarProps) {
  return <SidebarCurrent {...props} />;
}
