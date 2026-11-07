// A button that copies its text and says Copied for a moment, and the page's live region that announces it.

import { CopyButton as DesignCopyButton, LiveRegion } from '@lar-works/design-system';

import { useCopyStore } from './CopyStore';

export function CopyButton({ text, label }: { text: string; label: string }) {
    const announce = useCopyStore((state) => state.announce);

    return (
        <DesignCopyButton
            presentation="text"
            label={label}
            copyText="Copy"
            copiedLabel="Copied"
            value={text}
            onCopied={announce}
        />
    );
}

export function CopyStatus() {
    const announcement = useCopyStore((state) => state.announcement);

    return <LiveRegion id="copy-status">{announcement}</LiveRegion>;
}
