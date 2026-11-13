// Settings, the design system's SettingsDialog as lar-server's: the title bar's Settings button opens it over the board
// with the sections on the left, in groups, under a search (focused by /) that keeps the sections whose name or a row
// matches, and the open section on the right under its breadcrumb and description; a search that finds nothing says so
// with Clear search. A switch or a choice applies at once; a typed value is a draft the footer saves. A search that
// shows another section in place of the open one never loses a draft: each section it has shown stays mounted, hidden
// and inert, until the reader opens a section (which asks about drafts first). A child workflow (a project's page, Add
// project) replaces its section's content, with Back. Closing it returns to the board as it was, since the board stays
// rendered under it.

import { boardApp, shownRepo } from '@lar-factory/shared';
import {
    SettingsChildPane,
    SettingsDialog as Dialog,
    SettingsGroup,
    SettingsSectionPane,
    Text,
    useModalClose,
} from '@lar-works/design-system';
import { type ReactNode, useEffect, useMemo, useState } from 'react';

import { type Group, type Page, pages, settingsData, type SettingsData } from './SettingsPages';
import { filterSettingsPages } from './SettingsSearch';
import { useSettingsStore } from './SettingsStore';
import { useWizardStore, WizardPane } from '@/features/onboarding';
import { ProjectPage, projectSettings } from '@/features/repositories';
import { useUpdateStore } from '@/features/updates';
import { useArchiveStore } from '@/services/archive/archive.hooks';
import { useBoardStore } from '@/services/board/board.hooks';
import { FieldRow } from '@/shared/settings/FieldRow';
import { OpenSettingsButton } from '@/ui/board';

/** The section list's groups, by section id. */
const NAV: { label: string; ids: string[] }[] = [
    { label: 'Board', ids: ['general', 'factory', 'notifications', 'keybindings'] },
    { label: 'Connections', ids: ['projects', 'integrations', 't3', 'skills'] },
    { label: 'App', ids: ['updates', 'archive', 'diagnostics'] },
];

/** The title bar's last button, which opens Settings: an icon-only App control, its label in its title. */
export function SettingsButton() {
    return <OpenSettingsButton label="Settings" onOpen={() => useSettingsStore.getState().setOpen(true)} />;
}

/** T3's settings group: a title over a bordered list of rows, label left and control right, and what a row has below
 *  them; a row that draws itself (General's Appearance) takes its own place in the list. A search hides the rows it leaves out
 *  (`shown`) without unmounting them, so a draft in one survives; they go first, so the last row shown is the list's
 *  last and draws no divider under it. */
function GroupView({ group, shown }: { group: Group; shown?: ReadonlySet<string> | undefined }) {
    const left = (row: Group['rows'][number]) => !!shown && !shown.has(row.id);
    const rows = [...group.rows.filter(left), ...group.rows.filter((row) => !left(row))];

    return (
        <SettingsGroup
            title={group.title || undefined}
            description={group.description}
            help={group.help}
            helpLabel={group.title || undefined}
            action={group.action}
            footer={group.footer}
            note={group.note}
            panel={group.panel ?? (group.rows.length > 0 || !!group.footer)}
        >
            {rows.map((row) => (
                <div key={row.id} hidden={left(row) || undefined} inert={left(row) || undefined}>
                    {row.control.type === 'row' ? (
                        row.control.render()
                    ) : (
                        <FieldRow
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
                                <Text variant="caption" tone="muted">
                                    Not available yet
                                </Text>
                            )}
                        </FieldRow>
                    )}
                </div>
            ))}
        </SettingsGroup>
    );
}

/** Closes an Add project pane as Settings closes or opens another section; its run stays to resume, as when its own
 *  dialog closes. */
function leaveSetup() {
    const wizard = useWizardStore.getState();

    if (wizard.run && wizard.where === 'settings') wizard.close();
}

/** A project's page in place of Projects, the breadcrumb's third step ("Settings / Projects / lar-server"), its way
 *  back (to Projects) asking first about an unsaved draft, as changing section does. */
function ProjectPane({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
    const requestClose = useModalClose();

    return (
        <SettingsChildPane title={title} onBack={() => requestClose(onBack)}>
            {children}
        </SettingsChildPane>
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
    const q = query.trim().toLowerCase();
    const filtered = filterSettingsPages(all, q, data.repos, projectSettings);
    const filteredById = new Map(filtered.map((p) => [p.id, p]));
    const groups = NAV.map((group) => ({
        label: group.label,
        sections: group.ids
            .map((id) => filteredById.get(id))
            .filter((p) => !!p)
            .map((p) => ({ id: p.id, label: p.label, icon: p.icon })),
    }));
    const open = byId.get(section) ?? all[0]!;
    // A search that leaves out the open section shows the first one it keeps; one that finds nothing, none.
    const shownPage = filteredById.get(section) ?? filtered[0] ?? open;
    // A project's page stands in for Projects while one is open (opening one opens Projects, and any other section
    // forgets it).
    const setupOf = (id: string) =>
        id === 'projects' && project ? data.repos.find((r) => r.repo === project)?.setup : undefined;
    // Add project, or a Resume, from Projects: the setup stands in for the section's content, as a project's page does.
    const run = useWizardStore((state) => (state.where === 'settings' ? state.run : null));
    // The sections the search has shown since the reader last opened one: each stays mounted, hidden, so a draft
    // typed in it survives the search moving on. Opening a section (asked about first) lets them go.
    const [kept, setKept] = useState<{ section: string; ids: string[] }>({ section, ids: [] });

    if (kept.section !== section) setKept({ section, ids: [] });
    else if (shownPage.id !== open.id && !kept.ids.includes(shownPage.id))
        setKept({ section, ids: [...kept.ids, shownPage.id] });

    const panes = [...new Set([open.id, ...kept.ids, shownPage.id])].flatMap((id) => byId.get(id) ?? []);

    // A page in full, with what the search leaves out hidden rather than unmounted.
    const content = (p: Page) => {
        const projectSetup = setupOf(p.id);
        const match = q ? filteredById.get(p.id) : undefined;
        const groupsShown = match && new Set(match.groups.map((g) => g.title));
        const rowsShown = match && new Set(match.groups.flatMap((g) => g.rows.map((row) => row.id)));

        const groupViews = p.groups.map((g) => (
            <SettingsSectionPane key={g.title} shown={!groupsShown || groupsShown.has(g.title)}>
                <GroupView group={g} shown={rowsShown} />
            </SettingsSectionPane>
        ));

        const setupHere = !!run && p.id === 'projects';

        return projectSetup ? (
            <ProjectPane title={shownRepo(projectSetup.repo)} onBack={() => setSection('projects')}>
                <ProjectPage setup={projectSetup} />
            </ProjectPane>
        ) : (
            <>
                {/* Hidden, not gone, under the setup, so leaving it returns focus to the button that opened it. */}
                <SettingsSectionPane shown={!setupHere}>{groupViews}</SettingsSectionPane>
                {setupHere && <WizardPane run={run} />}
            </>
        );
    };

    return (
        <Dialog
            groups={groups}
            section={shownPage.id}
            // Opening a section, in a search too, is the reader's choice: the dialog asks about drafts first.
            onSectionChange={(id) => {
                leaveSetup();
                setSection(id);
            }}
            onClose={() => {
                leaveSetup();
                setOpen(false);
            }}
            query={query}
            onQueryChange={setQuery}
            // A child pane has its own heading, so the section's description goes while it shows.
            description={shownPage.description || undefined}
        >
            {panes.map((p) => (
                <SettingsSectionPane key={p.id} shown={p.id === shownPage.id}>
                    {content(p)}
                </SettingsSectionPane>
            ))}
        </Dialog>
    );
}

/** Settings while it's open. Confirmation dialogs stack over it; Add project and Resume take Projects' place. */
export function SettingsDialog() {
    const open = useSettingsStore((state) => state.open);

    return open ? <SettingsModal /> : null;
}
