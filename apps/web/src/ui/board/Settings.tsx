// Lar Factory's settings: the title bar's button that opens them, and a row's chevron that opens a page of its own. The settings themselves are the design system's
// SettingsDialog, SettingsGroup, SettingsRow and its parts (SettingsReason, SettingsNote, SettingsDetails,
// SettingsControl, SettingsValueList).

import { TitleBarSettingsButton } from '@lar-works/design-system';
import { ChevronRightIcon } from '@lar-works/design-system/icons';

/** The title bar's last button, which opens Settings: the design system's TitleBarSettingsButton, the same as
 *  the reference app's. */
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

/** A settings row's chevron that opens the page it names, such as a project's: a quiet control at the row's end whose
 *  target stretches over the whole row (factory-settings.css), so the row itself opens the page on a click, the
 *  chevron alone taking focus. */
export function SettingsRowOpen({
    label,
    onOpen,
}: {
    /** The button's accessible name, such as "Open api". */
    label: string;
    /** Called as the reader opens the page. */
    onOpen: () => void;
}) {
    return (
        <button
            type="button"
            aria-label={label}
            onClick={onOpen}
            data-settings-row-open
            data-settings-edge="ghost"
            className="text-fg-muted focus-ring grid size-8 place-items-center rounded-md after:absolute after:inset-0 after:content-[''] [&>svg]:size-4"
        >
            <ChevronRightIcon aria-hidden="true" />
        </button>
    );
}
