// T3's SidebarHeaderIconButton: a 28 px icon button in the sidebar's icon colour, its label in a tooltip.
// `render` swaps the button for another trigger, such as a dialog's.

import type { ReactElement, ReactNode } from 'react';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@lar-factory/ui/tooltip';

export function SidebarIconButton({ label, tooltip = label, className = '', render = <button type="button" />, onClick, children }: {
  label: string;
  /** The tooltip, when it says more than the label, such as the shortcut. */
  tooltip?: string;
  className?: string;
  render?: ReactElement;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={render} aria-label={label} onClick={onClick}
        className={`grid size-7 shrink-0 place-items-center rounded-(--control-radius) text-(--sidebar-icon-color) hover:bg-(--sidebar-row-hover) hover:text-(--sidebar-foreground) [&_svg]:size-4 ${className}`}>
        {children}
      </TooltipTrigger>
      <TooltipPopup side="top">{tooltip}</TooltipPopup>
    </Tooltip>
  );
}
