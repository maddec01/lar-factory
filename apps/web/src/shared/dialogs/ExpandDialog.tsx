// The expand button a dialog's header shows, with the keyboard shortcut named for this platform.

import { ModalExpandButton } from '@lar-works/design-system';

import { MAC } from './useExpand';

const SHORTCUT = MAC ? { label: '⌘⇧E', keys: 'Meta+Shift+E' } : { label: 'Ctrl+Shift+E', keys: 'Control+Shift+E' };

export function ExpandButton({ expanded, toggle }: { expanded: boolean; toggle: () => void }) {
    return <ModalExpandButton expanded={expanded} onToggle={toggle} shortcut={SHORTCUT} />;
}
