// A new ticket's labels: they start from the kind's mapping and follow it, and typed names wait here until the ticket
// submits. The picks reach the form as hidden fields, and each change fires input on the group, as a form select does.

import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { isManagedLabel, sameLabel, trackerCapabilities, writeAccessProblem } from '@lar-factory/shared';
import type { RepoConfig, TicketCreationOptions, TicketOptions, VocabularyKey } from '@lar-factory/shared';
import { Badge } from '@lar-factory/ui/design-system/Badge';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Popover } from '@lar-factory/ui/design-system/Popover';
import { kind as buttonKind } from '../buttons/button-kinds.tsx';
import { tint } from '../items/item-parts.tsx';
import { LabelPicker } from '../labels/label-picker.tsx';

const has = (labels: readonly string[], name: string) => labels.some((label) => sameLabel(label, name));
const without = (labels: readonly string[], gone: readonly string[]) => labels.filter((label) => !has(gone, label));
const colorOf = ({ labelColors }: Pick<TicketCreationOptions, 'labelColors'>, name: string) => (labelColors?.[name] ? `#${labelColors[name]}` : undefined);

export function DraftLabels({ repo, kind, read, kept, headingClass }: {
  repo: RepoConfig;
  kind: string;
  read: Pick<TicketCreationOptions, 'labels' | 'labelColors'>;
  kept?: TicketOptions | undefined;
  headingClass: string;
}) {
  const { heading, noun, nameProblem } = trackerCapabilities(repo.repo);
  const { setup } = repo;
  /** The labels mapped to `of` that the tracker has: one renamed or deleted outside the factory is left out. */
  const mapped = (of: string) => (setup?.vocabulary[of as VocabularyKey]?.labels ?? []).flatMap((label) => read.labels.find((name) => sameLabel(name, label)) ?? []);
  // A name typed in a kept draft that the tracker has by now, after a partly failed submission, is an ordinary pick.
  const [typed, setTyped] = useState(() => without(kept?.newLabels ?? [], read.labels));
  const [picked, setPicked] = useState(() => (kept?.labels ? [...read.labels.filter((name) => has([...kept.labels!, ...kept.newLabels ?? []], name)), ...typed] : mapped(kind)));
  const [mappedKind, setMappedKind] = useState(kind);
  if (mappedKind !== kind) {
    setMappedKind(kind);
    setPicked([...new Set([...without(picked, mapped(mappedKind)), ...mapped(kind)])]);
  }
  const group = useRef<HTMLDivElement>(null);
  const change = (update: () => void) => {
    flushSync(update);
    group.current?.dispatchEvent(new Event('input', { bubbles: true }));
  };
  // A managed label is never offered, but one the kind maps to stays on the ticket, as the board reads its kind from it.
  const locked = mapped(kind).filter(isManagedLabel);
  const choices = [...read.labels.filter((name) => !isManagedLabel(name)), ...locked, ...typed].map((name) => ({ name, color: colorOf(read, name) }));
  return (
    <div ref={group} id="item-labels" role="group" aria-label={heading} className="grid gap-1.5">
      <span className={headingClass}>{heading}</span>
      {picked.map((name) => <input key={name} type="hidden" name={has(typed, name) ? 'newLabels' : 'labels'} value={name} />)}
      <span className="flex flex-wrap items-center gap-1">
        {picked.map((name) => (
          <Badge key={name} data-label-chip className="max-w-full" style={tint(colorOf(read, name))}>
            <span className="max-w-52 truncate" title={name}>{name}</span>{has(typed, name) && <span className="opacity-70">new</span>}
          </Badge>
        ))}
        <Popover>
          <Popover.Trigger asChild>
            <Button {...buttonKind('other')} rightIcon={<ChevronDown />}>{picked.length ? 'Edit' : `Add ${noun}`}</Button>
          </Popover.Trigger>
          <Popover.Content side="bottom" align="start">
            <LabelPicker heading={heading} choices={choices} picked={picked} locked={locked}
              onToggle={(name) => change(() => setPicked(has(picked, name) ? without(picked, [name]) : [...picked, name]))}
              create={{
                noun, problem: nameProblem, note: `The new ${noun} is created when the ticket submits.`,
                refused: writeAccessProblem(repo.repo, 'manage-labels', setup?.access ?? {}, { azureReadOnly: setup?.azureReadOnly }),
                onCreate: (name) => change(() => { setTyped([...typed, name]); setPicked([...picked, name]); }),
              }} />
          </Popover.Content>
        </Popover>
      </span>
    </div>
  );
}
