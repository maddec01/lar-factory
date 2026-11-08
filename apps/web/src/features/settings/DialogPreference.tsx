// A dialog preference's switch, reading and saving this browser's choice when it changes.

import { useState } from 'react';

import { DIALOG_PREFERENCES, dialogPreference } from '@/shared/dialogs/useExpand';
import { Switch } from '@/shared/settings/SettingControls';

export function DialogPreference({
    preference,
    label,
}: {
    preference: keyof typeof DIALOG_PREFERENCES;
    label: string;
}) {
    const [on, setOn] = useState(() => dialogPreference(preference));

    return (
        <Switch
            label={label}
            on={on}
            onChange={(next) => {
                localStorage.setItem(DIALOG_PREFERENCES[preference], next ? '1' : '0');
                setOn(next);
            }}
        />
    );
}
