// Add item captures a draft locally or creates its tracker ticket, and can find existing tickets.

import { noneOnboarded, repoName } from '@lar-factory/shared';
import { Button, Modal, Text, ViewToggle } from '@lar-works/design-system';
import { useEffect, useState } from 'react';

import { AddItemForm } from './AddItemForm';
import type { AddItemPane } from './AddItemStore';
import { useAddItemStore } from './AddItemStore';
import { NoProjectNotice } from './NoProjectNotice';
import { RepoSelect } from './RepoSelect';
import { TicketPicker } from './TicketPicker';
import { useBoardStore } from '@/services/board/board.hooks';
import { sampleCapability } from '@/shared/capabilities/sampleCapability';
import { ExpandButton } from '@/shared/dialogs/ExpandDialog';
import { useExpand } from '@/shared/dialogs/useExpand';
import { AddItemButton, buttonKind, PanelField, TicketSearchPane } from '@/ui/board';

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
            <TicketSearchPane id="pick-ticket">
                <NoProjectNotice />
                <PanelField heading="Project" htmlFor="pick-repo">
                    <RepoSelect id="pick-repo" repo={selected?.repo ?? ''} onRepo={setRepo} />
                </PanelField>
                <TicketPicker
                    id="pick"
                    repo={selected?.repo ?? ''}
                    disabled={disabled}
                    key={selected?.repo}
                    onPick={(ticket) => pick(selected!.repo, ticket)}
                />
            </TicketSearchPane>
            <Modal.Footer
                leading={
                    data.capture?.enabled === false && (
                        <Text variant="caption" tone="muted" id="pick-ticket-reason">
                            {sampleCapability(data, 'createIssue')}
                        </Text>
                    )
                }
            >
                <Button {...buttonKind('other', { size: 'md' })} onClick={() => setOpen(false)}>
                    Cancel
                </Button>
            </Modal.Footer>
        </>
    );
}

/** New work or Find a ticket, as two buttons, the shown pane's pressed. */
function PaneSwitch() {
    const { pane, setPane } = useAddItemStore();

    return <ViewToggle presentation="text" label="Add" value={pane} onChange={setPane} options={PANES} />;
}

const PANES = [
    { value: 'new', label: 'New work', attributes: { 'data-pane': 'new' } },
    { value: 'pick', label: 'Find a ticket', attributes: { 'data-pane': 'pick' } },
] as const satisfies readonly { value: AddItemPane; label: string; attributes: { 'data-pane': string } }[];

/** What the shown pane does, in the repository the form has picked: the kept draft's, else the first. */
function useDescription(): string {
    const repos = useBoardStore((state) => state.data.repos);
    const { pane, values } = useAddItemStore();
    const selected = repos.find((r) => r.repo === values?.repo) ?? repos[0];
    const where = selected ? ` in ${repoName(selected.repo, repos)}` : '';

    return pane === 'pick' ? 'Find a ticket to add or open in List.' : `Record work${where} and add it to List.`;
}

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
                fitsContent={false}
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
    const none = useBoardStore((state) => noneOnboarded(state.data));

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
            <AddItemButton
                label="Add item"
                title="Add item (⌘N)"
                keyShortcuts="Meta+N"
                waits={none}
                onOpen={() => setOpen(true)}
            />
            {open && <AddItemDialog />}
        </>
    );
}
