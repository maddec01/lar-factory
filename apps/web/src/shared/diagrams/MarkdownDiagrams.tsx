// Markdown whose ```mermaid blocks draw as diagrams, as a concept map or an item's description holds them.

import { Diagram, RichText } from '@lar-works/design-system';

/** Mermaid runs locally in strict mode. Issue text can't enable HTML or links. */
async function drawMermaid(source: string, id: string): Promise<string> {
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

    return svg;
}

export function MarkdownDiagrams({ text }: { text: string }) {
    return (
        <RichText
            text={text}
            format="markdown"
            renderDiagram={(source) => (
                <Diagram
                    source={source}
                    draw={drawMermaid}
                    label="Concept map diagram"
                    failedLabel="The diagram couldn’t be drawn. Its source is available below."
                    sourceLabel="Diagram source"
                />
            )}
        />
    );
}
