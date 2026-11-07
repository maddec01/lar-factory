// The design system's LabelPicker in the board's words: what the tracker calls its labels names its filter, a label
// the kind sets says so, and a new label's button reads Create "name".

import { LabelPicker as DesignLabelPicker, type LabelChoice } from '@lar-works/design-system';

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

export function LabelPicker({
    heading,
    create,
    ...props
}: {
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
    const filter = `Filter ${heading.toLowerCase()}`;

    return (
        <DesignLabelPicker
            {...props}
            filterLabel={filter}
            placeholder={create && !create.refused ? `Filter or type a new ${create.noun}` : filter}
            noMatchLabel="No match."
            lockedNote="set by kind"
            {...(create && { create: { ...create, createLabel: (name: string) => `Create "${name}"` } })}
        />
    );
}
