// A searchable checklist of labels. It holds only its search text: the caller gives the choices, what is picked and
// what a toggle does, so it reads and writes whichever way its surface needs. A surface can also let a typed name in.

import { useState } from 'react';
import { sameLabel } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Checkbox } from '@lar-factory/ui/design-system/Checkbox';
import { Input } from '@lar-factory/ui/design-system/Input';
import { Plus } from 'lucide-react';
import { kind } from '../buttons/button-kinds.tsx';

export interface LabelChoice {
  name: string;
  /** A CSS colour; a tracker with no label colours gives none. */
  color?: string | undefined;
  description?: string | undefined;
}

/** Lets a typed name no choice has become a new label. */
interface LabelCreation {
  /** What the tracker calls a label, in a sentence. */
  noun: string;
  /** Why this person can't add new labels at all, or null when they can. */
  refused: string | null;
  /** Why this name can't be a label, or null when it can. */
  problem: (name: string) => string | null;
  /** What adding one does. */
  note: string;
  onCreate: (name: string) => void;
}

export function LabelPicker({ heading, choices, picked, onToggle, locked = [], busy = false, create }: {
  /** What the tracker calls its labels. */
  heading: string;
  choices: readonly LabelChoice[];
  picked: readonly string[];
  onToggle: (name: string) => void;
  /** Choices shown ticked or not but not changeable here, as the kind sets them. */
  locked?: readonly string[];
  busy?: boolean;
  create?: LabelCreation;
}) {
  const [query, setQuery] = useState('');
  const typed = query.trim();
  const hits = choices.filter(({ name }) => name.toLowerCase().includes(typed.toLowerCase()));
  const fresh = !!create && !!typed && !choices.some(({ name }) => sameLabel(name, typed));
  const refusal = fresh ? create.refused ?? create.problem(typed) : null;
  const add = () => {
    create?.onCreate(typed);
    setQuery('');
  };
  return (
    <div className="grid w-72 gap-2" data-label-picker aria-busy={busy}>
      <Input autoFocus placeholder={create && !create.refused ? `Filter or type a new ${create.noun}` : `Filter ${heading.toLowerCase()}`} aria-label={`Filter ${heading.toLowerCase()}`}
        value={query} onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          if (fresh && !refusal) add();
        }} />
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
        {!hits.length && !fresh && <p className="m-0 p-1.5 text-[11px] text-(--muted-foreground)">No match.</p>}
      </div>
      {fresh && !refusal && <Button {...kind('other')} className="justify-self-start" leftIcon={<Plus />} onClick={add}>Create "{typed}"</Button>}
      {refusal && <p role="alert" className="m-0 text-[11px] text-(--muted-foreground)">{refusal}</p>}
      {create && !create.refused && <p className="m-0 text-[11px] text-(--muted-foreground)">{create.note}</p>}
    </div>
  );
}
