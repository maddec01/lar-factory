// PROTOTYPE, throwaway. Sidebar variant C: placeholder, a subagent fills it in.

import type { SidebarProps } from './sidebar-data.ts';
import { SidebarCurrent } from './sidebar-current.tsx';

export const NAME = 'Variant C (to build)';

export function SidebarC(props: SidebarProps) {
  return <SidebarCurrent {...props} />;
}
