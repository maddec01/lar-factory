import { useLayoutEffect, useState } from 'react';

/** Attach to the scroll owner and its content so async content and viewport changes update the mask. */
export function useScrollFade() {
    const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
    const [content, setContent] = useState<HTMLDivElement | null>(null);

    useLayoutEffect(() => {
        if (!viewport || !content) return;

        const measure = () => {
            const { scrollTop, scrollHeight, clientHeight } = viewport;

            viewport.style.setProperty('--scroll-fade-top', `${Math.max(0, scrollTop)}px`);
            viewport.style.setProperty(
                '--scroll-fade-bottom',
                `${Math.max(0, scrollHeight - clientHeight - scrollTop)}px`,
            );
        };
        const observer = new ResizeObserver(measure);

        const observeContent = () => {
            observer.disconnect();
            observer.observe(viewport);
            observer.observe(content);
            // Fill layouts can keep ancestors fixed while descendants change the scroll extent.
            content.querySelectorAll('*').forEach((element) => observer.observe(element));
            measure();
        };
        const mutations = new MutationObserver(observeContent);

        mutations.observe(content, { childList: true, subtree: true });
        viewport.addEventListener('scroll', measure, { passive: true });
        observeContent();

        return () => {
            mutations.disconnect();
            observer.disconnect();
            viewport.removeEventListener('scroll', measure);
        };
    }, [viewport, content]);

    return {
        setViewport,
        setContent,
        className:
            '[mask-image:linear-gradient(to_bottom,transparent,black_min(1.5rem,var(--scroll-fade-top,0px)),black_calc(100%_-_min(1.5rem,var(--scroll-fade-bottom,0px))),transparent)] focus-visible:[mask-image:none] has-[:focus-visible]:[mask-image:none]',
    };
}
