import type { TrackerCapabilities } from '@lar-factory/shared';
import { Button, buttonKind, Input, InsetPanel } from '@lar-works/design-system';
import { Plus } from '@lar-works/design-system/icons';
import { useState, type FormEvent } from 'react';

import { useEditStore } from './EditStore';
import { ProblemText } from './LabelParts';
import { FieldRow } from '@/shared/settings/FieldRow';

/** The field that creates a label. Its typing stays here, so a keystroke re-renders no row. */
export function CreateLabel({
    capabilities,
    cannotCreate,
    showUnavailable,
    onCreate,
}: {
    capabilities: TrackerCapabilities;
    cannotCreate: string | null;
    showUnavailable: boolean;
    onCreate: (name: string) => Promise<string | null>;
}) {
    const { noun, createUnavailable, nameProblem } = capabilities;
    const running = useEditStore((s) => s.running);
    const [fresh, setFresh] = useState('');
    const [failure, setFailure] = useState<string | null>(null);
    const problem = fresh.trim() ? nameProblem(fresh) : null;
    const create = async (event: FormEvent) => {
        event.preventDefault();

        if (cannotCreate || problem || !fresh.trim()) return;

        const failed = await onCreate(fresh.trim());

        setFailure(failed);

        if (!failed) setFresh('');
    };

    return (
        <>
            <InsetPanel presentation="settings">
                <FieldRow label={`New ${noun}`}>
                    <form className="flex max-w-full min-w-0 flex-wrap gap-2" onSubmit={(event) => void create(event)}>
                        <Input
                            data-new-label
                            aria-label={`New ${noun}`}
                            placeholder={`New ${noun} name`}
                            value={fresh}
                            disabled={!!cannotCreate || running !== null}
                            onChange={(e) => {
                                setFresh(e.target.value);
                                setFailure(null);
                            }}
                        />
                        <Button
                            {...buttonKind('other')}
                            type="submit"
                            className="shrink-0"
                            leftIcon={<Plus />}
                            disabled={!!cannotCreate || !!problem || !fresh.trim() || running !== null}
                            {...(cannotCreate && { title: cannotCreate })}
                        >
                            Create {noun}
                        </Button>
                    </form>
                </FieldRow>
            </InsetPanel>
            {showUnavailable && <p className="text-base-700 m-0 text-xs">{createUnavailable}</p>}
            <ProblemText>{problem ?? failure}</ProblemText>
        </>
    );
}
