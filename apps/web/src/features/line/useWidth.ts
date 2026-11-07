import { useEffect, useRef, useState } from 'react';

/** The width of the box `ref` goes on, followed as it resizes. */
export function useWidth() {
    const ref = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);

    useEffect(() => {
        const el = ref.current;

        if (!el) return;

        const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));

        observer.observe(el);

        return () => observer.disconnect();
    }, []);

    return { ref, width };
}
