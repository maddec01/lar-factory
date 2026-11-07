import type { TrackerCapabilities, TrackerLabel } from '@lar-factory/shared';
import { Badge, Button, buttonKind } from '@lar-works/design-system';
import { Lock, Pencil, Trash2 } from '@lar-works/design-system/icons';

import { useEditStore, type LabelChange } from './EditStore';
import { LabelEditor } from './LabelEditor';

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
        <li data-label={label.name} className="border-b last:border-b-0">
            <div className="flex min-w-0 items-center gap-3 px-3 py-1.5">
                <span className="max-w-[45%] min-w-0">
                    <Badge
                        data-label-chip
                        className="max-w-full min-w-0"
                        labelColor={capabilities.color && label.color ? `#${label.color}` : undefined}
                    >
                        <span className="inline-flex min-w-0 items-center gap-1">
                            {locked && <Lock className="size-3 shrink-0" aria-label="Factory-managed" />}
                            <span className="truncate" title={label.name}>
                                {label.name}
                            </span>
                        </span>
                    </Badge>
                </span>
                <span className="text-base-700 min-w-0 flex-1 truncate text-xs" title={detail}>
                    {detail}
                </span>
                {!locked && (
                    <span className="flex shrink-0 gap-1">
                        <Button
                            {...buttonKind('control')}
                            data-icon-only=""
                            aria-label={`Edit ${label.name}`}
                            title={readOnly ?? `Edit ${label.name}`}
                            disabled={disabled}
                            leftIcon={<Pencil />}
                            onClick={() => onEdit(!editing)}
                        />
                        <Button
                            {...buttonKind('control')}
                            data-icon-only=""
                            aria-label={`Delete ${label.name}`}
                            title={readOnly ?? `Delete ${label.name}`}
                            disabled={disabled}
                            leftIcon={<Trash2 />}
                            onClick={onDelete}
                        />
                    </span>
                )}
            </div>
            {editing && (
                <LabelEditor
                    label={label}
                    capabilities={capabilities}
                    mappings={mappings}
                    onSave={onSave}
                    onDone={() => onEdit(false)}
                />
            )}
        </li>
    );
}
