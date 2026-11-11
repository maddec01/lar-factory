// A new ticket's labels: they start from the kind's mapping and follow it, and typed names wait here until the ticket
// submits. The picks reach the form as hidden fields, and each change fires input on the group, as a form select does.

import { sameLabel, trackerCapabilities, writeAccessProblem } from '@lar-factory/shared';
import type { RepoConfig, TicketCreationOptions, TicketOptions, VocabularyKey } from '@lar-factory/shared';
import { Button, HiddenField, Inline, LabelChip, Popover } from '@lar-works/design-system';
import { ChevronDown } from '@lar-works/design-system/icons';
import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { LabelPicker } from '@/shared/labels/LabelPicker';
import { buttonKind, PanelField } from '@/ui/board';

const has = (labels: readonly string[], name: string) => labels.some((label) => sameLabel(label, name));
const without = (labels: readonly string[], gone: readonly string[]) => labels.filter((label) => !has(gone, label));
const colorOf = ({ labelColors }: Pick<TicketCreationOptions, 'labelColors'>, name: string) =>
    labelColors?.[name] ? `#${labelColors[name]}` : undefined;

export function DraftLabels({
    repo,
    kind,
    read,
    kept,
}: {
    repo: RepoConfig;
    kind: string;
    read: Pick<TicketCreationOptions, 'labels' | 'labelColors'>;
    kept?: TicketOptions | undefined;
}) {
    const { heading, noun, nameProblem, isManaged } = trackerCapabilities(repo.repo);
    const { setup } = repo;
    /** The labels mapped to `of` that the tracker has: one renamed or deleted outside the factory is left out. */
    const mapped = (of: string) =>
        (setup?.vocabulary[of as VocabularyKey]?.labels ?? []).flatMap(
            (label) => read.labels.find((name) => sameLabel(name, label)) ?? [],
        );
    // A name typed in a kept draft that the tracker has by now, after a partly failed submission, is an ordinary pick.
    const [typed, setTyped] = useState(() => without(kept?.newLabels ?? [], read.labels));
    const [picked, setPicked] = useState(() =>
        kept?.labels
            ? [...read.labels.filter((name) => has([...kept.labels!, ...(kept.newLabels ?? [])], name)), ...typed]
            : mapped(kind),
    );
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
    const locked = mapped(kind).filter(isManaged);
    const choices = [...read.labels.filter((name) => !isManaged(name)), ...locked, ...typed].map((name) => ({
        name,
        color: colorOf(read, name),
    }));

    return (
        <PanelField ref={group} id="item-labels" heading={heading}>
            {picked.map((name) => (
                <HiddenField key={name} name={has(typed, name) ? 'newLabels' : 'labels'} value={name} />
            ))}
            <Inline as="span" wrap align="center" space="tight">
                {picked.map((name) => (
                    <LabelChip
                        key={name}
                        label={name}
                        color={colorOf(read, name)}
                        note={has(typed, name) ? 'new' : undefined}
                    />
                ))}
                <Popover>
                    <Popover.Trigger asChild>
                        <Button {...buttonKind('other', { size: 'md' })} rightIcon={<ChevronDown />}>
                            {picked.length ? 'Edit' : `Add ${noun}`}
                        </Button>
                    </Popover.Trigger>
                    <Popover.Content side="bottom" align="start">
                        <LabelPicker
                            heading={heading}
                            choices={choices}
                            picked={picked}
                            locked={locked}
                            onToggle={(name) =>
                                change(() => setPicked(has(picked, name) ? without(picked, [name]) : [...picked, name]))
                            }
                            create={{
                                noun,
                                problem: nameProblem,
                                note: `The new ${noun} is created when the ticket submits.`,
                                refused: writeAccessProblem(repo.repo, 'manage-labels', setup?.access ?? {}, {
                                    azureReadOnly: setup?.azureReadOnly,
                                }),
                                onCreate: (name) =>
                                    change(() => {
                                        setTyped([...typed, name]);
                                        setPicked([...picked, name]);
                                    }),
                            }}
                        />
                    </Popover.Content>
                </Popover>
            </Inline>
        </PanelField>
    );
}
