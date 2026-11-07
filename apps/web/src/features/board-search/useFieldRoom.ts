import { useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';

/** The room in `wrapper` and the title bar, and each child's width in `ghost`, which draws every token out of sight to be measured. */
export function useFieldRoom(
    wrapper: RefObject<HTMLElement | null>,
    ghost: RefObject<HTMLElement | null>,
    tokens: string,
) {
    const [room, setRoom] = useState({ field: 0, bar: 0 });
    const [widths, setWidths] = useState<number[]>([]);

    useLayoutEffect(() => {
        const measure = () => {
            setRoom({
                field: wrapper.current!.getBoundingClientRect().width,
                bar: wrapper.current!.closest('header')!.getBoundingClientRect().width,
            });

            const next = [...ghost.current!.children].map((child) => (child as HTMLElement).offsetWidth);

            setWidths((now) => (now.join() === next.join() ? now : next));
        };

        measure();

        // The ghost resizes too when a late web font changes the tokens' widths.
        const observer = new ResizeObserver(measure);

        observer.observe(wrapper.current!);
        observer.observe(ghost.current!);

        return () => observer.disconnect();
    }, [wrapper, ghost, tokens]);

    return { room, widths };
}
