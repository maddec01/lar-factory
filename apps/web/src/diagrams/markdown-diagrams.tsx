import { RichText } from '@lar-factory/ui/rich-text';
import { useEffect, useId, useRef, useState } from 'react';

/** Mermaid runs locally in strict mode. Issue text cannot enable HTML or links. */
function Diagram({ source }: { source: string }) {
    const id = useId().replace(/[^a-zA-Z0-9]/g, '');
    const host = useRef<HTMLDivElement>(null);
    // The source the diagram failed on, so a new source draws afresh.
    const [failed, setFailed] = useState<string | null>(null);
    const problem = failed === source ? 'The diagram could not be drawn. Its source is available below.' : null;

    useEffect(() => {
        const drawn = new AbortController();
        const render = async () => {
            try {
                const { default: mermaid } = await import('mermaid');

                mermaid.initialize({
                    startOnLoad: false,
                    securityLevel: 'strict',
                    theme: 'neutral',
                    suppressErrorRendering: true,
                    flowchart: { htmlLabels: false },
                    maxTextSize: 50_000,
                });

                const { svg } = await mermaid.render(`concept-${id}`, source);

                if (!drawn.signal.aborted && host.current) host.current.innerHTML = svg;
            } catch {
                if (!drawn.signal.aborted) setFailed(source);
            }
        };

        void render();

        return () => drawn.abort();
    }, [id, source]);

    return (
        <figure className="m-0 grid min-w-0 gap-2 rounded-lg border p-3" data-map-diagram>
            {problem ? (
                <p role="status" className="text-base-700 m-0 text-xs">
                    {problem}
                </p>
            ) : (
                <div
                    ref={host}
                    className="overflow-auto [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
                    role="img"
                    aria-label="Concept map diagram"
                />
            )}
            <details className="text-base-700 text-xs">
                <summary className="cursor-pointer">Diagram source</summary>
                <pre className="overflow-auto pt-2 whitespace-pre-wrap">{source}</pre>
            </details>
        </figure>
    );
}

export function MarkdownDiagrams({ text }: { text: string }) {
    const parts = text.split(/```mermaid[^\S\r\n]*\r?\n([\s\S]*?)```/g);

    return (
        <div className="grid min-w-0 gap-3">
            {parts.map((part, index) =>
                index % 2 === 1 ? (
                    <Diagram key={index} source={part.trim()} />
                ) : part.trim() ? (
                    <RichText key={index} text={part} format="markdown" />
                ) : null,
            )}
        </div>
    );
}
