// A settings row as the board's settings, onboarding and project pages write it: the design system's SettingsRow in its
// flow layout, which the board's rows use, marked with the setting's id.

import { SettingsRow } from '@lar-works/design-system';
import type { ReactNode } from 'react';

export function FieldRow({
    label,
    help,
    description,
    children,
    below,
    error,
    id,
}: {
    label: ReactNode;
    help?: ReactNode;
    description?: ReactNode;
    children?: ReactNode;
    below?: ReactNode;
    error?: string | undefined;
    /** The setting's id: the row's `data-row` and `data-setting`, and its error's `${id}-error`. */
    id?: string;
}) {
    return (
        <SettingsRow
            label={label}
            help={help}
            helpLabel={typeof label === 'string' ? label : 'this setting'}
            description={description}
            below={below}
            error={error}
            errorId={id ? `${id}-error` : undefined}
            data-row={id}
            data-setting={id}
        >
            {children}
        </SettingsRow>
    );
}
