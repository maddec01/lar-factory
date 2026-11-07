// One kind's vocabulary draft, the pending change a close commits, and what the tracker allows.

import {
    kindMappingOffers,
    newLabelProblem,
    trackerCapabilities,
    writeAccessProblem,
    type VocabularyTerm,
} from '@lar-factory/shared';
import {
    suggestVocabularyLabels,
    type VocabularyCapability,
    type VocabularyDiscovery,
} from '@lar-factory/shared/vocabulary';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { KIND_NAMES, type VocabularyAccess, type VocabularyKind } from './VocabularyKinds';

function vocabularyAccess(setup: VocabularyAccess) {
    const options = setup.azureReadOnly === undefined ? {} : { azureReadOnly: setup.azureReadOnly };

    return {
        labels: writeAccessProblem(setup.repo, 'tag-ticket', setup.access, options),
        newLabels: newLabelProblem(setup.repo, setup.access, options),
        types: writeAccessProblem(setup.repo, 'type-ticket', setup.access, options),
    };
}

const unavailable = (capability: VocabularyCapability) => (capability.state === 'available' ? null : capability.reason);

export function useVocabularyFields({
    name,
    setup,
    discovery,
    value,
    newLabels,
    onChange,
    onCommit,
}: {
    name: VocabularyKind;
    setup: VocabularyAccess;
    discovery: VocabularyDiscovery;
    value: VocabularyTerm;
    newLabels: string[];
    onChange: (value: VocabularyTerm, newLabels: string[]) => void;
    onCommit?: ((value: VocabularyTerm, newLabels: string[]) => void) | undefined;
}) {
    const [open, setOpen] = useState(false);
    const changed = useRef(false);
    const latest = useRef({ value, newLabels, onCommit });

    useLayoutEffect(() => {
        latest.current = { value, newLabels, onCommit };
    });
    useEffect(
        () => () => {
            if (changed.current) latest.current.onCommit?.(latest.current.value, latest.current.newLabels);
        },
        [],
    );

    const access = vocabularyAccess(setup);
    const labelsProblem = unavailable(discovery.labels) ?? access.labels;
    const noTypes = discovery.types.state === 'available' && !discovery.types.choices.length;
    const typesProblem = unavailable(discovery.types) ?? (noTypes && !value.type ? null : access.types);
    const { noun, heading } = trackerCapabilities(setup.repo);
    const plural = heading.toLowerCase();
    const labels =
        discovery.labels.state === 'available'
            ? discovery.labels.choices.filter((label) => kindMappingOffers(setup.repo, label))
            : [];
    const types = discovery.types.state === 'available' ? discovery.types.choices : [];
    const title = KIND_NAMES[name];
    const chosen = [...value.labels, ...newLabels];
    const suggestions = suggestVocabularyLabels(discovery.labels)[name]?.labels ?? [];
    const suggested = !labelsProblem && !chosen.length ? suggestions[0] : undefined;
    const offered = [...new Set([...suggestions, ...chosen, ...labels])].filter(
        (label) => chosen.includes(label) || labels.includes(label),
    );
    const update = (term: VocabularyTerm, fresh = newLabels, commit = !open) => {
        onChange(term, fresh);

        if (commit) {
            changed.current = false;
            onCommit?.(term, fresh);
        } else changed.current = true;
    };
    const toggle = (label: string) => {
        if (newLabels.includes(label))
            update(
                value,
                newLabels.filter((item) => item !== label),
            );
        else
            update({
                ...value,
                labels: value.labels.includes(label)
                    ? value.labels.filter((item) => item !== label)
                    : [...value.labels, label],
            });
    };
    const close = (next: boolean) => {
        setOpen(next);

        if (!next && changed.current) {
            changed.current = false;
            onCommit?.(value, newLabels);
        }

        if (next) {
            changed.current = false;
        }
    };
    const choose = (label: string | undefined) => {
        if (label && (!labelsProblem || chosen.includes(label))) toggle(label);
    };
    const gone = (label: string) =>
        discovery.labels.state === 'available' &&
        !discovery.labels.choices.includes(label) &&
        !newLabels.includes(label);

    /** Commits the kind again after its save failed. */
    const retryCommit = () => {
        changed.current = false;
        onCommit?.(value, newLabels);
    };

    return {
        open,
        retryCommit,
        access,
        labelsProblem,
        typesProblem,
        noun,
        plural,
        labels,
        types,
        title,
        chosen,
        suggested,
        offered,
        update,
        toggle,
        close,
        choose,
        gone,
    };
}
