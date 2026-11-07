// Settings, as lar-server's SettingsDialog: the title bar's Settings button opens a modal over the board with the
// sections on the left, in groups, and the open section on the right under its title and description. Search settings,
// on top of the sections and focused by /, keeps the sections whose name or a row matches, or says none does. Closing it
// returns to the board as it was, since the board stays rendered under it.

import { boardApp, shownRepo } from '@lar-factory/shared';
import {
    BoardNote,
    Button,
    buttonKind,
    FormSection,
    Input,
    InsetPanel,
    Modal,
    OpenSettingsButton,
    SettingsGroups,
    SettingsNav,
    SidebarNavigationGroup,
    SidebarNavigationItem,
} from '@lar-works/design-system';
import { useEffect, useMemo, useRef, useState } from 'react';

import { type Group, type Page, pages, settingsData, type SettingsData } from './SettingsPages';
import { useSettingsStore } from './SettingsStore';
import { ProjectPage, projectSettings } from '@/features/repositories';
import { useUpdateStore } from '@/features/updates';
import { useArchiveStore } from '@/services/archive/archive.hooks';
import { useBoardStore } from '@/services/board/board.hooks';
import { FieldRow } from '@/shared/settings/FieldRow';

/** The section list's groups, by section id. */
const NAV: { label: string; ids: string[] }[] = [
    { label: 'Board', ids: ['general', 'appearance', 'notifications', 'keybindings'] },
    { label: 'Connections', ids: ['projects', 'integrations', 't3', 'skills'] },
    { label: 'App', ids: ['updates', 'archive', 'diagnostics'] },
];

/** The title bar's last button, which opens Settings: an icon-only App control, its label in its title. */
export function SettingsButton() {
    return <OpenSettingsButton label="Settings" onOpen={() => useSettingsStore.getState().setOpen(true)} />;
}

/** T3's SettingsGroup: a title over a bordered list of rows, label left and control right, and what a row has below them. */
function GroupView({ group }: { group: Group }) {
    return (
        <FormSection
            presentation="dense"
            data-settings-group=""
            title={group.title || undefined}
            help={group.help}
            helpLabel={group.title}
            description={group.description}
        >
            {(group.rows.length > 0 || group.footer) && (
                <InsetPanel presentation="settings" footer={group.footer}>
                    {group.rows.map((row) => (
                        <FieldRow
                            key={row.id}
                            id={row.id}
                            label={
                                row.icon ? (
                                    <>
                                        {row.icon}
                                        {row.title}
                                    </>
                                ) : (
                                    row.title
                                )
                            }
                            help={row.help}
                            description={row.description}
                            below={row.below}
                        >
                            {row.control.type === 'custom' ? (
                                row.control.render()
                            ) : (
                                <BoardNote>Not available yet</BoardNote>
                            )}
                        </FieldRow>
                    ))}
                </InsetPanel>
            )}
            {group.note}
        </FormSection>
    );
}

function SettingsModal() {
    // Each push parses into new objects, so only the text can tell that nothing Settings shows changed.
    const shown = useBoardStore((state) => JSON.stringify(settingsData(state.data)));
    const data = useMemo(() => JSON.parse(shown) as SettingsData, [shown]);
    const targets = useSettingsStore((state) => state.targets);
    const version = useUpdateStore((state) => state.state?.currentVersion ?? null);
    const { section, project, setSection, setOpen } = useSettingsStore();
    // The title bar's Update pill follows the updater too, but it isn't there above the missing-t3 notice.
    const follow = useUpdateStore((state) => state.follow);

    useEffect(follow, [follow]);

    const archived = useArchiveStore((state) => state.items);
    const archiveProblem = useArchiveStore((state) => state.problem);

    // Archive stays off the board data, so it's read each time its section opens.
    useEffect(() => {
        if (section === 'archive') void useArchiveStore.getState().load();
    }, [section]);

    const all = pages({
        data,
        app: !!boardApp(),
        targets,
        version,
        archive: { items: archived, problem: archiveProblem },
    });
    const byId = new Map(all.map((p) => [p.id, p]));
    const [query, setQuery] = useState('');
    const search = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            const typing =
                event.target instanceof HTMLElement &&
                event.target.closest('input, textarea, select, [contenteditable]');
            // A dialog over Settings keeps its keys.
            const over =
                event.target instanceof Node &&
                event.target !== document.body &&
                !search.current?.closest('[role="dialog"]')?.contains(event.target);

            if (event.key !== '/' || typing || over || event.metaKey || event.ctrlKey || event.altKey) return;

            event.preventDefault();
            search.current?.focus();
        };

        addEventListener('keydown', onKey);

        return () => removeEventListener('keydown', onKey);
    }, []);

    const q = query.trim().toLowerCase();
    const matches = (p: Page) =>
        !q ||
        p.label.toLowerCase().includes(q) ||
        (p.id === 'projects' &&
            data.repos.some(
                (r) =>
                    r.repo.toLowerCase().includes(q) ||
                    (!!r.setup && projectSettings(r.repo).some((field) => field.label.toLowerCase().includes(q))),
            )) ||
        p.groups.some(
            (g) => g.title.toLowerCase().includes(q) || g.rows.some((r) => r.title.toLowerCase().includes(q)),
        );
    const nav = NAV.map((group) => ({
        label: group.label,
        pages: group.ids.map((id) => byId.get(id)).filter((p): p is Page => !!p && matches(p)),
    }));
    const open = byId.get(section) ?? all[0]!;
    // A search that leaves out the open section shows the first section it keeps, without choosing it, so clearing the
    // search goes back. One that keeps none leaves the open section on the right, beside "No settings match.".
    const page = matches(open) ? open : (nav.flatMap((group) => group.pages)[0] ?? open);
    const setup = page.id === 'projects' && project ? data.repos.find((r) => r.repo === project)?.setup : undefined;
    const title = setup ? shownRepo(setup.repo) : page.label;

    return (
        <Modal onClose={() => setOpen(false)}>
            <Modal.Content
                accessibleTitle={`Settings: ${title}`}
                title={title}
                description={setup ? undefined : page.description || undefined}
                sidebar={
                    <SettingsNav
                        data-settings-nav=""
                        label="Settings sections"
                        search={
                            <Input
                                ref={search}
                                type="search"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Search settings"
                                aria-label="Search settings"
                                aria-keyshortcuts="/"
                                title="Search settings (/)"
                            />
                        }
                        empty={nav.every((group) => !group.pages.length) ? 'No settings match.' : undefined}
                    >
                        {nav.map(
                            (group) =>
                                group.pages.length > 0 && (
                                    <SidebarNavigationGroup key={group.label} label={group.label}>
                                        {group.pages.map((p) => (
                                            <SidebarNavigationItem
                                                key={p.id}
                                                active={p.id === page.id}
                                                onClick={() => setSection(p.id)}
                                            >
                                                {p.icon}
                                                <span>{p.label}</span>
                                            </SidebarNavigationItem>
                                        ))}
                                    </SidebarNavigationGroup>
                                ),
                        )}
                    </SettingsNav>
                }
            >
                <Modal.Body key={setup?.repo ?? page.id}>
                    <SettingsGroups data-settings-body="">
                        {setup ? (
                            <>
                                <span>
                                    <Button {...buttonKind('other')} onClick={() => setSection('projects')}>
                                        ← Projects
                                    </Button>
                                </span>
                                <ProjectPage setup={setup} />
                            </>
                        ) : (
                            page.groups.map((g) => <GroupView group={g} key={g.title} />)
                        )}
                    </SettingsGroups>
                </Modal.Body>
            </Modal.Content>
        </Modal>
    );
}

/** Settings while it's open. Onboarding and confirmation dialogs stack over it. */
export function SettingsDialog() {
    const open = useSettingsStore((state) => state.open);

    return open ? <SettingsModal /> : null;
}
