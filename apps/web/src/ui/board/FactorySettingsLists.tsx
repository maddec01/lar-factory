import { Button, Disclosure, OptionSelect, Text } from '@lar-works/design-system';
import type { ReactNode } from 'react';

type ChoiceProps = {
    label: string;
    value: string;
    options: { value: string; label: string; disabled?: boolean }[];
    onChange: (value: string) => void;
};

export function FactoryReviewerMode(props: ChoiceProps) {
    return <OptionSelect {...props} presentation="inline" />;
}

export function FactoryCellChoice({ context, ...props }: ChoiceProps & { context: string }) {
    return (
        <td data-label={props.label}>
            <OptionSelect {...props} presentation="field" label={`${context} ${props.label.toLowerCase()}`} />
        </td>
    );
}

export function FactoryModelTable({
    label,
    rowHeader,
    children,
}: {
    label: string;
    rowHeader: string;
    children: ReactNode;
}) {
    return (
        <table className="factory-model-table" aria-label={label}>
            <colgroup>
                <col />
                <col className="factory-model-column" />
                <col className="factory-effort-column" />
            </colgroup>
            <thead>
                <tr>
                    <th scope="col">{rowHeader}</th>
                    <th scope="col">Model</th>
                    <th scope="col">Effort</th>
                </tr>
            </thead>
            <tbody>{children}</tbody>
        </table>
    );
}

export function FactoryModelRow({ label, children }: { label: string; children: ReactNode }) {
    return (
        <tr>
            <th scope="row">{label}</th>
            {children}
        </tr>
    );
}

export function FactoryReviewerRow({
    name,
    packaged,
    editing,
    mode,
    instructions,
    onEdit,
    onDuplicate,
    onRemove,
    children,
}: {
    name: string;
    packaged: boolean;
    editing: boolean;
    mode: ReactNode;
    instructions: string;
    onEdit: () => void;
    onDuplicate: () => void;
    onRemove: () => void;
    children: ReactNode;
}) {
    return (
        <section className="factory-reviewer-row" aria-label={`${name} reviewer`}>
            <div className="factory-reviewer-summary">
                <div className="factory-reviewer-name">
                    <Text variant="label">{name}</Text>
                    <Text variant="caption" tone="muted">
                        {packaged ? 'Packaged' : 'Custom'}
                    </Text>
                </div>
                <div className="factory-reviewer-controls">
                    {mode}
                    <div className="factory-settings-actions">
                        {packaged ? (
                            <Button variant="secondary" onClick={onDuplicate}>
                                Duplicate
                            </Button>
                        ) : (
                            <>
                                <Button variant="secondary" onClick={onEdit} aria-expanded={editing}>
                                    {editing ? 'Done editing' : 'Edit'}
                                </Button>
                                <Button variant="secondary" onClick={onRemove}>
                                    Delete
                                </Button>
                            </>
                        )}
                    </div>
                </div>
            </div>
            {packaged && (
                <Disclosure label="Show instructions" presentation="note" lazy>
                    <div className="factory-reviewer-instructions">
                        <Text variant="caption">{instructions}</Text>
                    </div>
                </Disclosure>
            )}
            {children}
        </section>
    );
}
