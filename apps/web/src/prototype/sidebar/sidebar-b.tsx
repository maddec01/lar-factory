// PROTOTYPE, throwaway. Sidebar variant B: placeholder, a subagent fills it in.

import type { SidebarProps } from './sidebar-data.ts';
import { SidebarCurrent } from './sidebar-current.tsx';

export const NAME = 'Variant B (to build)';

export function SidebarB(props: SidebarProps) {
  return <SidebarCurrent {...props} />;
}
