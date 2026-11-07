// Add item captures a draft locally or creates its tracker ticket, and can find existing tickets.

import { repoName } from '@lar-factory/shared';
import { Button, buttonKind, Modal } from '@lar-works/design-system';
import { SquarePen } from '@lar-works/design-system/icons';
import { useEffect, useState } from 'react';

import { AddItemForm } from './AddItemForm';
import { useAddItemStore } from './AddItemStore';
import type { AddItemPane } from './AddItemStore';
import { PanelSection } from './IssueFields';
import { HINT, RepoSelect } from './RepoSelect';
import { TicketPicker } from './TicketPicker';
import { useBoardStore } from '@/services/board/board.hooks';
import { ExpandButton, useExpand } from '@/shared/dialogs/ExpandDialog';

/** Find a ticket: the repository, then the ticket picker for it. Picking closes the dialog. */
function PickTicketPane() {
    const data = useBoardStore((state) => state.data);
    const { pick, setOpen } = useAddItemStore();
    const [repo, setRepo] = useState(() => useAddItemStore.getState().values?.repo ?? data.repos[0]?.repo ?? '');
    // Opened before the repositories arrived, repo matches none: the first is then selected.
    const selected = data.repos.find((r) => r.repo === repo) ?? data.repos[0];
    const disabled = data.capture?.enabled === false || !selected;

    return (
        <>
            <div
                className="border-base-300 grid min-h-0 content-start gap-4 overflow-y-auto border-t px-5 pt-4 pb-5 sm:px-6"
                id="pick-ticket"
            >
                <p className={HINT}>Find tickets outside your list, or open one you’ve already added.</p>
                <PanelSection heading="Project" htmlFor="pick-repo">
                    <RepoSelect id="pick-repo" repo={selected?.repo ?? ''} onRepo={setRepo} />
                </PanelSection>
                <TicketPicker
                    id="pick"
                    repo={selected?.repo ?? ''}
                    disabled={disabled}
                    key={selected?.repo}
                    onPick={(ticket) => pick(selected!.repo, ticket)}
                />
                {data.capture?.enabled === false && <p className={HINT}>Picking tickets is disabled in sample mode.</p>}
            </div>
            <Modal.Footer>
                <Button {...buttonKind('other')} onClick={() => setOpen(false)}>
                    Cancel
                </Button>
            </Modal.Footer>
        </>
    );
}

/** New work or Find a ticket, as two buttons, the shown pane's pressed. */
function PaneSwitch() {
    const { pane, setPane } = useAddItemStore();
    const choice = (to: AddItemPane, label: string) => (
        <button
            type="button"
            data-pane={to}
            aria-pressed={pane === to}
            onClick={() => setPane(to)}
            className={`focus-visible:ring-primary h-7 rounded-md px-2.5 text-xs font-medium outline-none focus-visible:ring-2 ${pane === to ? 'bg-base-100 text-base-content shadow-sm' : 'hover:text-base-content text-(--muted-foreground)'}`}
        >
            {label}
        </button>
    );

    return (
        <div role="group" aria-label="Add" className="bg-base-200 flex gap-0.5 rounded-lg p-0.5">
            {choice('new', 'New work')}
            {choice('pick', 'Find a ticket')}
        </div>
    );
}

/** What the shown pane does, in the repository the form has picked: the kept draft's, else the first. */
function useDescription(): string {
    const repos = useBoardStore((state) => state.data.repos);
    const { pane, values } = useAddItemStore();
    const selected = repos.find((r) => r.repo === values?.repo) ?? repos[0];
    const where = selected ? ` in ${repoName(selected.repo, repos)}` : '';

    return pane === 'pick' ? `Find an open ticket${where}.` : `Record work${where} and add it to List.`;
}

/** Find a ticket's pane is short, so the dialog keeps its width but takes the pane's height; a long result list scrolls inside it. */
const FITS_CONTENT = { height: 'auto' };

/** The open dialog; each opening starts at the normal size. */
function AddItemDialog() {
    const { draft, pane, setOpen } = useAddItemStore();
    const [expanded, toggleExpanded] = useExpand();
    const description = useDescription();

    return (
        <Modal onClose={() => setOpen(false)}>
            {/* ninna-ui's Modal drops the description from aria-describedby, so a hidden copy of it describes the dialog. */}
            <Modal.Content
                id="add-item-dialog"
                title="Add item"
                description={description}
                aria-describedby="add-item-description"
                presentation="paned"
                expanded={expanded}
                style={!expanded && pane === 'pick' ? FITS_CONTENT : undefined}
                headerActions={
                    <>
                        <PaneSwitch />
                        <ExpandButton expanded={expanded} toggle={toggleExpanded} />
                    </>
                }
            >
                <span id="add-item-description" hidden>
                    {description}
                </span>
                {/* A new draft remounts the form, which clears its fields. */}
                {pane === 'pick' ? <PickTicketPane /> : <AddItemForm key={draft} />}
            </Modal.Content>
        </Modal>
    );
}

export function AddItem() {
    const { open, setOpen } = useAddItemStore();

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.metaKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'n') {
                event.preventDefault();
                useAddItemStore.getState().setOpen(true);
            }
        };

        addEventListener('keydown', onKey);

        return () => removeEventListener('keydown', onKey);
    }, []);

    return (
        <>
            <Button
                {...buttonKind('main')}
                className="add-item px-2"
                leftIcon={<SquarePen />}
                title="Add item (⌘N)"
                aria-keyshortcuts="Meta+N"
                onClick={() => setOpen(true)}
            >
                <span className="@max-[70rem]:sr-only">Add item</span>
            </Button>
            {open && <AddItemDialog />}
        </>
    );
}
