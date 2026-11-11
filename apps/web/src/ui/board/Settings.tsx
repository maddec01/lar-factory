// Lar Factory's settings: the title bar's button that opens them. The settings themselves are the design system's
// SettingsDialog, SettingsGroup, SettingsRow and its parts (SettingsReason, SettingsNote, SettingsDetails,
// SettingsControl, SettingsValueList).

import { TitleBarSettingsButton } from '@lar-works/design-system';

/** The title bar's last button, which opens Settings: the design system's TitleBarSettingsButton, the same as
 *  lar-server's. */
export function OpenSettingsButton({
    label,
    onOpen,
}: {
    /** The button's accessible name, such as "Settings". */
    label: string;
    /** Called as the reader opens Settings. */
    onOpen: () => void;
}) {
    return <TitleBarSettingsButton label={label} onOpen={onOpen} />;
}
