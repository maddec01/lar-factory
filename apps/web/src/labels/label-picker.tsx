// A searchable checklist of labels. It holds only its search text: the caller gives the choices, what is picked and
// what a toggle does, so it reads and writes whichever way its surface needs.

import { useState } from 'react';
import { sameLabel } from '@lar-factory/shared';
import { Checkbox } from '@lar-factory/ui/design-system/Checkbox';
import { Input } from '@lar-factory/ui/design-system/Input';

export interface LabelChoice {
  name: string;
  /** A CSS colour; a tracker with no label colours gives none. */
  color?: string | undefined;
  description?: string | undefined;
}

export function LabelPicker({ heading, choices, picked, onToggle, locked = [], busy = false }: {
  /** What the tracker calls its labels. */
  heading: string;
  choices: readonly LabelChoice[];
  picked: readonly string[];
  onToggle: (name: string) => void;
  /** Choices shown ticked or not but not changeable here, as the kind sets them. */
  locked?: readonly string[];
  busy?: boolean;
}) {
  const [query, setQuery] = useState('');
  const hits = choices.filter(({ name }) => name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="grid w-72 gap-2" data-label-picker aria-busy={busy}>
      <Input autoFocus placeholder={`Filter ${heading.toLowerCase()}`} aria-label={`Filter ${heading.toLowerCase()}`} value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="grid max-h-56 gap-0.5 overflow-y-auto">
        {hits.map(({ name, color, description }) => {
          const fixed = locked.some((label) => sameLabel(label, name));
          return (
            <label key={name} data-label-choice className="flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-(--accent)">
              <Checkbox checked={picked.some((label) => sameLabel(label, name))} disabled={fixed} onChange={() => onToggle(name)} />
              {color && <span data-label-dot className="mt-1 size-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />}
              <span className="min-w-0 flex-1">
                <span className="block wrap-anywhere">{name}{fixed && <span className="text-(--muted-foreground)"> · set by kind</span>}</span>
                {description && <span className="block text-[11px] text-(--muted-foreground)">{description}</span>}
              </span>
            </label>
          );
        })}
        {!hits.length && <p className="m-0 p-1.5 text-[11px] text-(--muted-foreground)">No match.</p>}
      </div>
    </div>
  );
}
