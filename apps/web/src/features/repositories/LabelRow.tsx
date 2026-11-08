import type { TrackerCapabilities, TrackerLabel } from '@lar-factory/shared';
import { Button, LabelChip } from '@lar-works/design-system';
import { Pencil, Trash2 } from '@lar-works/design-system/icons';

import { useEditStore, type LabelChange } from './EditStore';
import { LabelEditor } from './LabelEditor';
import { buttonKind, TrackerLabelRow } from '@/ui/board';

export function LabelRow({
    label,
    capabilities,
    mappings,
    readOnly,
    editing,
    onEdit,
    onDelete,
    onSave,
}: {
    label: TrackerLabel;
    capabilities: TrackerCapabilities;
    mappings: string | null;
    readOnly: string | null;
    editing: boolean;
    onEdit: (editing: boolean) => void;
    onDelete: () => void;
    onSave: (change: LabelChange) => Promise<string | null>;
}) {
    const running = useEditStore((s) => s.running);
    const locked = capabilities.isManaged(label.name);
    const detail = locked
        ? `Factory-managed. ${capabilities.nameProblem(label.name)}`
        : capabilities.description
          ? label.description
          : undefined;
    const disabled = !!readOnly || running !== null;

    return (
        <TrackerLabelRow
            data-label={label.name}
            chip={
                <LabelChip
                    label={label.name}
                    color={capabilities.color && label.color ? `#${label.color}` : undefined}
                    locked={locked}
                    lockedLabel="Factory-managed"
                />
            }
            detail={detail}
            actions={
                !locked && (
                    <>
                        <Button
                            {...buttonKind('control')}
                            iconOnly
                            aria-label={`Edit ${label.name}`}
                            title={readOnly ?? `Edit ${label.name}`}
                            disabled={disabled}
                            leftIcon={<Pencil />}
                            onClick={() => onEdit(!editing)}
                        />
                        <Button
                            {...buttonKind('control')}
                            iconOnly
                            aria-label={`Delete ${label.name}`}
                            title={readOnly ?? `Delete ${label.name}`}
                            disabled={disabled}
                            leftIcon={<Trash2 />}
                            onClick={onDelete}
                        />
                    </>
                )
            }
            editor={
                editing && (
                    <LabelEditor
                        label={label}
                        capabilities={capabilities}
                        mappings={mappings}
                        onSave={onSave}
                        onDone={() => onEdit(false)}
                    />
                )
            }
        />
    );
}
