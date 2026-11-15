// Settings › Archive: this Mac's retention setting, whose new automatic deletion names the work it would delete now and
// saves only on its own confirm. A saved setting reads Archive again. Each archived row's actions are ArchiveActions'.

import { clock, day, plural, type RetentionState } from '@lar-factory/shared';
import {
    Button,
    FormUnit,
    Input,
    InsetPanel,
    SettingsFooter,
    showNotification,
    Stack,
    Text,
    useSettingsDraft,
} from '@lar-works/design-system';
import { useState } from 'react';
import { flushSync } from 'react-dom';

import { useArchiveStore } from '@/services/archive/archive.hooks';
import { postAction, receive } from '@/services/board/board.service';
import { FieldRow } from '@/shared/settings/FieldRow';
import { Choice } from '@/shared/settings/SettingControls';
import { ActionError, buttonKind, LoadFailed, SettingConfirm, SettingLastRun } from '@/ui/board';

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
 * When finished and set-aside work leaves the board, and whether the board deletes it later: a draft of its days and
 * choice, which Settings' footer saves or cancels, and which leaving asks about first. Saving a new automatic deletion
 * asks first, in place of the footer, naming the work it would delete now, so Export markdown and Restore are still
 * there for it.
 */
export function RetentionSetting({ retention }: { retention: RetentionState }) {
    const [hide, setHide] = useState(String(retention.hideAfterDays));
    const [deleting, setDeleting] = useState(retention.deleteAfterDays !== null);
    const [deleteAfter, setDeleteAfter] = useState(String(retention.deleteAfterDays ?? 30));
    const [due, setDue] = useState<Due | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const hideDays = wholeDays(hide);
    const deleteDays = deleting ? wholeDays(deleteAfter) : null;
    const invalid = hideDays === null || (deleting && deleteDays === null);
    const dirty =
        hide !== String(retention.hideAfterDays) ||
        deleting !== (retention.deleteAfterDays !== null) ||
        (deleting && deleteAfter !== String(retention.deleteAfterDays ?? 30));
    const reset = () => {
        setHide(String(retention.hideAfterDays));
        setDeleting(retention.deleteAfterDays !== null);
        setDeleteAfter(String(retention.deleteAfterDays ?? 30));
        setDue(null);
        setError(null);
    };

    // Its own footer saves it, as saving may stop to confirm; the draft only guards against losing it.
    useSettingsDraft(dirty);

    const save = async (confirmed = false) => {
        setSaving(true);
        setError(null);

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

            if (result.error) setError(result.error);
            else if (result.saved === false) setDue(result.due ?? []);
            else {
                setDue(null);
                showNotification({ slot: 'retention', title: 'Saved the retention setting on this Mac.' });
            }
        });
    };

    if (retention.problem)
        return (
            <LoadFailed
                what="the retention setting"
                reason={`${retention.problem} The board keeps and shows all work until the setting can be read.`}
            />
        );

    return (
        <Stack space="group" data-retention>
            <InsetPanel presentation="settings">
                {/* Two flat rows whose day fields line up at their end, the deletion's choice before its field. */}
                <FieldRow id="retention-hide" label="Hide finished and set-aside work after">
                    <FormUnit unit="days">
                        <Input
                            type="number"
                            min={0}
                            step={1}
                            inputMode="numeric"
                            aria-label="Days before hiding"
                            value={hide}
                            disabled={saving}
                            onChange={(e) => setHide(e.target.value)}
                        />
                    </FormUnit>
                </FieldRow>
                <FieldRow id="retention-delete" label="Delete hidden work">
                    <Choice
                        label="Delete hidden work"
                        value={deleting ? 'delete' : 'keep'}
                        busy={saving}
                        onChange={(next) => {
                            setDeleting(next === 'delete');
                            setDue(null);
                        }}
                        options={[
                            { value: 'keep', label: 'Never' },
                            { value: 'delete', label: 'After' },
                        ]}
                    />
                    {deleting && (
                        <FormUnit unit="days">
                            <Input
                                type="number"
                                min={0}
                                step={1}
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
            {due && (
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
                            <Button {...buttonKind('other', { size: 'md' })} onClick={() => setDue(null)}>
                                Cancel
                            </Button>
                            <Button
                                {...buttonKind('main', { tone: 'danger', size: 'md' })}
                                loading={saving}
                                data-confirm-delete
                                onClick={() => void save(true)}
                            >
                                {due.length ? `Delete ${due.length} now` : 'Turn on automatic deletion'}
                            </Button>
                        </>
                    }
                />
            )}
            {invalid && (
                <Text variant="caption" tone="muted">
                    Enter whole days from 0.
                </Text>
            )}
            {dirty && !due && (
                <SettingsFooter
                    leading={
                        error ? (
                            <ActionError>{error}</ActionError>
                        ) : (
                            <Text as="span" variant="caption" tone="muted">
                                Unsaved changes
                            </Text>
                        )
                    }
                >
                    <Button {...buttonKind('other', { size: 'md' })} disabled={saving} onClick={reset}>
                        Cancel
                    </Button>
                    <Button
                        {...buttonKind('main', { size: 'md' })}
                        disabled={invalid}
                        loading={saving}
                        data-save-retention
                        onClick={() => void save()}
                    >
                        Save changes
                    </Button>
                </SettingsFooter>
            )}
            {error && due && <ActionError>{error}</ActionError>}
            {retention.lastDelete && <LastDelete lastDelete={retention.lastDelete} />}
        </Stack>
    );
}
