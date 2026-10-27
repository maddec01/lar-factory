import { cloneElement, type ComponentPropsWithoutRef, isValidElement, useEffect, useRef } from 'react';

import { StatusIndicator } from '../../feedback/StatusIndicator';
import { tabbable } from '../../foundations/KeyboardFocus';

type SidebarNavigationItemProps = Omit<ComponentPropsWithoutRef<'button'>, 'className' | 'style' | 'type'> & {
    active?: boolean;
    /** Styles its only child, such as a router link, instead of wrapping it in a second tab stop. */
    asChild?: boolean;
    notification?: string;
};

export function SidebarNavigationItem({
    active = false,
    asChild = false,
    children,
    notification,
    ...props
}: SidebarNavigationItemProps) {
    const target = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        if (active) target.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }, [active]);

    const item = {
        ...tabbable,
        'aria-current': active ? ('page' as const) : undefined,
        'aria-description': notification,
        className: `flex h-8 shrink-0 items-center gap-2 rounded-md px-2 text-sm transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary [&>svg]:size-4 ${active ? 'bg-base-200 font-medium text-base-content dark:bg-base-300 [&>svg]:text-base-content' : 'text-base-content/80 hover:bg-base-200/70 hover:text-base-content [&>svg]:text-base-700'}`,
    };

    const indicator = notification ? <StatusIndicator tone="warning" size="sm" className="ml-auto" /> : null;

    if (asChild && isValidElement<ComponentPropsWithoutRef<'button'>>(children)) {
        return cloneElement(children, item, children.props.children, indicator);
    }

    return (
        <button ref={target} {...props} {...item} type="button">
            {children}
            {indicator}
        </button>
    );
}
