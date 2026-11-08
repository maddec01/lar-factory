// Settings › Archive: each piece of work off the board, set aside or finished and hidden by retention, with Export
// markdown, Restore for set-aside work and Close ticket while its ticket is open, and this Mac's retention setting. A
// new automatic deletion names the work it would delete now and saves only on its own confirm. Restore and a saved setting
// read Archive again.

import { clock, day, plural, type Item, type RetentionState } from '@lar-factory/shared';
import { Alert, Button, FormUnit, Input, InsetPanel, Stack, Text } from '@lar-works/design-system';
import { useState } from 'react';
import { flushSync } from 'react-dom';

import { ExportedLine, ExportMarkdown, type Exported } from '@/features/item-dialog';
import { useAbandonStore } from '@/features/items';
import { useArchiveStore } from '@/services/archive/archive.hooks';
import { postAction, receive } from '@/services/board/board.service';
import { FieldRow } from '@/shared/settings/FieldRow';
import { Choice } from '@/shared/settings/SettingControls';
import { ActionStack, buttonKind, SettingConfirm, SettingLastRun } from '@/ui/board';

/** Export markdown, Restore for set-aside work, and Close ticket while the board sees its ticket open. */
export function ArchiveActions({ item }: { item: Item }) {
    const [exported, setExported] = useState<Exported>({ state: 'idle' });
    const [restoring, setRestoring] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const closeable = item.archived?.setAside && item.archived.ticketOpen && item.number > 0 && !item.abandonRefusal;
    const restore = async () => {
        setRestoring(true);
        setError(null);

        const result = await postAction('/api/restore', { itemId: item.id });

        // A restored item leaves Archive with this row, once Archive is read again.
        if (!result.error) await useArchiveStore.getState().load();

        flushSync(() => {
            receive(result);
            setRestoring(false);
            setError(result.error);
        });
    };

    return (
        <ActionStack below={<ExportedLine exported={exported} />} error={error}>
            <ExportMarkdown itemId={item.id} exported={exported} setExported={setExported} />
            {closeable && (
                <Button
                    {...buttonKind('other')}
                    data-archive-close={item.id}
                    onClick={() => useAbandonStore.getState().askClose(item)}
                >
                    Close ticket
                </Button>
            )}
            {item.archived?.setAside && (
                <Button
                    {...buttonKind('other')}
                    data-restore={item.id}
                    loading={restoring}
                    onClick={() => void restore()}
                >
                    Restore
                </Button>
            )}
        </ActionStack>
    );
}

/** What saving a automatic deletion asks before it saves: the work it would delete now. */
type Due = { workId: string; title: string }[];

const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

/** A whole number of days from 0, or null for anything else. */
function wholeDays(text: string): number | null {
    const n = Number(text);

    return text.trim() !== '' && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/** What the last automatic deletion did, naming each piece of work it kept and why. */
function LastDelete({ lastDelete }: { lastDelete: NonNullable<RetentionState['lastDelete']> }) {
    return (
        <SettingLastRun
            summary={`The last automatic deletion, ${day(lastDelete.at, undefined)} at ${clock(lastDelete.at, undefined)}, deleted ${plural(lastDelete.deleted.length, 'record')}.`}
            kept={lastDelete.kept.map((k) => `Kept ${k.workId}. ${k.reason}`)}
        />
    );
}

/**
 * When finished and set-aside work leaves the board, and whether the board deletes it later. Saving a new automatic deletion
 * asks first, naming the work it would delete now, so Export markdown and Restore are still there for it.
 */
export function RetentionSetting({ retention }: { retention: RetentionState }) {
    const [hide, setHide] = useState(String(retention.hideAfterDays));
    const [deleting, setDeleting] = useState(retention.deleteAfterDays !== null);
    const [deleteAfter, setDeleteAfter] = useState(String(retention.deleteAfterDays ?? 30));
    const [due, setDue] = useState<Due | null>(null);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
    const hideDays = wholeDays(hide);
    const deleteDays = deleting ? wholeDays(deleteAfter) : null;
    const invalid = hideDays === null || (deleting && deleteDays === null);

    const save = async (confirmed = false) => {
        setSaving(true);
        setMessage(null);

        const result = await postAction<{ saved: boolean; due: Due }>('/api/retention', {
            hideAfterDays: hideDays,
            deleteAfterDays: deleteDays,
            confirmed,
        });

        // A saved setting can hide, show or delete work in Archive.
        if (result.saved) await useArchiveStore.getState().load();

        flushSync(() => {
            receive(result);
            setSaving(false);

            if (result.error) setMessage({ text: result.error, error: true });
            else if (result.saved === false) setDue(result.due ?? []);
            else {
                setDue(null);
                setMessage({ text: 'Saved the retention setting on this Mac.', error: false });
            }
        });
    };

    if (retention.problem)
        return (
            <Alert size="sm" tone="danger">
                {retention.problem} The board keeps and shows all work until the setting can be read.
            </Alert>
        );

    return (
        <Stack space="group" data-retention>
            <InsetPanel presentation="settings">
                <FieldRow label="Hide finished and set-aside work after">
                    <FormUnit unit="days">
                        <Input
                            inputMode="numeric"
                            aria-label="Days before hiding"
                            value={hide}
                            disabled={saving}
                            onChange={(e) => setHide(e.target.value)}
                        />
                    </FormUnit>
                </FieldRow>
                <FieldRow label="Delete hidden work">
                    <Choice
                        label="Delete hidden work"
                        value={deleting ? 'delete' : 'keep'}
                        busy={saving}
                        onChange={(next) => {
                            setDeleting(next === 'delete');
                            setDue(null);
                        }}
                        options={[
                            { value: 'keep', label: 'Keep it' },
                            { value: 'delete', label: 'Delete it after' },
                        ]}
                    />
                    {deleting && (
                        <FormUnit unit="days">
                            <Input
                                inputMode="numeric"
                                aria-label="Days before deleting"
                                value={deleteAfter}
                                disabled={saving}
                                onChange={(e) => {
                                    setDeleteAfter(e.target.value);
                                    setDue(null);
                                }}
                            />
                        </FormUnit>
                    )}
                </FieldRow>
            </InsetPanel>
            {due ? (
                <SettingConfirm
                    label="Turn on automatic deletion"
                    message={
                        due.length
                            ? `Turning on automatic deletion deletes this work now, with its brief, threads and reviews. Export or restore it below first.`
                            : `Nothing is old enough to delete now. Work will be deleted ${days(deleteDays ?? 0)} after it’s finished or set aside.`
                    }
                    items={due.map((d) => d.title || d.workId)}
                    actions={
                        <>
                            <Button {...buttonKind('other')} onClick={() => setDue(null)}>
                                Cancel
                            </Button>
                            <Button
                                {...buttonKind('main', 'danger')}
                                loading={saving}
                                data-confirm-delete
                                onClick={() => void save(true)}
                            >
                                {due.length ? `Delete ${due.length} now` : 'Turn on automatic deletion'}
                            </Button>
                        </>
                    }
                />
            ) : (
                <span>
                    <Button
                        {...buttonKind('other')}
                        disabled={invalid}
                        loading={saving}
                        data-save-retention
                        onClick={() => void save()}
                    >
                        Save
                    </Button>
                </span>
            )}
            {invalid && (
                <Text variant="caption" tone="muted">
                    Enter whole days from 0.
                </Text>
            )}
            {message &&
                (message.error ? (
                    <Alert size="sm" tone="danger" message={message.text} />
                ) : (
                    <Text variant="caption" tone="muted" role="status">
                        {message.text}
                    </Text>
                ))}
            {retention.lastDelete && <LastDelete lastDelete={retention.lastDelete} />}
        </Stack>
    );
}
