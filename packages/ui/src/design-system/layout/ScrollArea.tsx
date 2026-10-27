import type { ComponentPropsWithoutRef } from 'react';

export type ScrollAreaProps = Omit<ComponentPropsWithoutRef<'div'>, 'className' | 'style'>;

export function ScrollArea(props: ScrollAreaProps) {
    return <div {...props} className="min-h-0 max-h-64 overflow-y-auto overscroll-contain pr-1" />;
}
