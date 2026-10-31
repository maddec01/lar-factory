import { useEffect, useId, useRef, useState } from 'react';
import { RichText } from '@lar-factory/ui/rich-text';

/** Mermaid runs locally in strict mode. Issue text cannot enable HTML or links. */
export function Diagram({ source }: { source: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const host = useRef<HTMLDivElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    setProblem(null);
    const render = async () => {
      try {
        const { default: mermaid } = await import('mermaid');
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral', suppressErrorRendering: true,
          flowchart: { htmlLabels: false }, maxTextSize: 50_000 });
        const { svg } = await mermaid.render(`concept-${id}`, source);
        if (current && host.current) host.current.innerHTML = svg;
      } catch {
        if (current) setProblem('The diagram could not be drawn. Its source is available below.');
      }
    };
    void render();
    return () => { current = false; };
  }, [id, source]);
  return <figure className="m-0 grid min-w-0 gap-2 rounded-lg border p-3" data-map-diagram>
    {problem ? <p role="status" className="m-0 text-xs text-base-700">{problem}</p>
      : <div ref={host} className="overflow-auto [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full" role="img" aria-label="Concept map diagram" />}
    <details className="text-xs text-base-700"><summary className="cursor-pointer">Diagram source</summary><pre className="overflow-auto whitespace-pre-wrap pt-2">{source}</pre></details>
  </figure>;
}

export function MarkdownDiagrams({ text }: { text: string }) {
  const parts = text.split(/```mermaid[^\S\r\n]*\r?\n([\s\S]*?)```/g);
  return <div className="grid min-w-0 gap-3">{parts.map((part, index) => index % 2 === 1 ? <Diagram key={index} source={part.trim()} />
    : part.trim() ? <RichText key={index} text={part} format="markdown" /> : null)}</div>;
}
