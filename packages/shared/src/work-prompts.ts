// Instructions sent to work threads; separate from board copy.

import type { ModelSelection } from './board-domain.ts';
import { type Item } from './domain.ts';
import { visibleKind } from './managed-labels.ts';
import { itemName } from './presentation.ts';
import { azureReadOnlyLines, frozenBuildMethodLine, frozenRetroLine, type RunSettings } from './run-settings.ts';

export interface FactoryThreadContext {
    dataDir: string;
    bin: string;
    shapeSkill: string;
    buildSkill: string;
    azureReadOnly?: boolean;
    delegationModel?: ModelSelection;
    /** This machine's saved Auto-build switch at launch; absent in older shaping prompts. */
    autoBuild?: boolean;
    /** The run the thread starts for, whose IDs and frozen choices its runtime block names. */
    run?: RunSettings;
    /** A run saved before launches were recorded keeps the earlier two runtime blocks, so retries and recovery match. */
    earlier?: boolean;
}

const shellPath = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

/** The board's first runtime block before runs recorded their launches. */
function earlierFactoryEnvironment(context: FactoryThreadContext): string {
    return [
        '<!-- factory-runtime:start -->',
        'Runtime instructions belong only in thread prompts/handoffs; never copy this block into product records (brief, map, decision, answer or domain drafts). Read frozen choices from run-settings records.',
        'Use the factory installation and data folder below for this thread and every subagent.',
        'Before running any factory command, set this environment in that command shell:',
        `export LAR_FACTORY_DATA_DIR=${shellPath(context.dataDir)}`,
        `export PATH=${shellPath(context.bin)}:"$PATH"`,
        `export LAR_FACTORY_BIN=${shellPath(context.bin)}`,
        `export LAR_FACTORY_SHAPE_SKILL=${shellPath(context.shapeSkill)}`,
        `export LAR_FACTORY_BUILD_SKILL=${shellPath(context.buildSkill)}`,
        ...azureReadOnlyLines(context.azureReadOnly),
        `Use ${shellPath(`${context.bin}/lar-work`)} for work records. Never use another data folder or command installation.`,
        `Factory skill entries: ${JSON.stringify({ 'lar-shape': context.shapeSkill, 'lar-build': context.buildSkill })}`,
        'Pass these exact skill entries and the CLI/data environment above verbatim in every child task prompt and handoff, including Explore and Approver. Children must read the supplied entry for their role first and resolve its relative files from that entry; never discover skills independently or read a global installation first. If a supplied entry is unavailable, hold and report its exact path.',
        'The target repository needs no factory files or factory instructions in AGENTS.md or CLAUDE.md.',
        ...(context.delegationModel
            ? [
                  `Default every delegated role to this T3 target unless this run explicitly supplies a role override: ${JSON.stringify({ providerInstanceId: context.delegationModel.instanceId, model: context.delegationModel.model, options: Object.fromEntries(context.delegationModel.options?.map(({ id, value }) => [id, value]) ?? []) })}. Pass this default to every delegated task.`,
              ]
            : []),
        '<!-- factory-runtime:end -->',
    ].join('\n');
}

/** The one runtime block of a thread's first message: only what the thread can't read from its skills or records. */
function factoryEnvironment(context: FactoryThreadContext, shaping = false): string {
    const { run } = context;

    if (context.earlier)
        return `${earlierFactoryEnvironment(context)}${run ? `\n\n${earlierRunSettingsMessage(run)}` : ''}`;

    return [
        '<!-- factory-runtime:start -->',
        'Runtime instructions only: keep them in thread prompts and handoffs, never in product records.',
        ...(shaping && context.autoBuild !== undefined
            ? [
                  `Saved Auto-build at launch: ${context.autoBuild ? 'on' : 'off'}; the board displays the current setting if it changes before approval.`,
              ]
            : []),
        ...(run ? [`Work ID ${run.workId}; run ID ${run.runId}.`] : []),
        `Factory skill entries: ${JSON.stringify({ 'lar-shape': context.shapeSkill, 'lar-build': context.buildSkill })}`,
        'Before factory commands, set this environment in that command shell:',
        `export LAR_FACTORY_DATA_DIR=${shellPath(context.dataDir)}`,
        `export PATH=${shellPath(context.bin)}:"$PATH"`,
        ...(run ? [`export LAR_FACTORY_RUN_ID=${shellPath(run.runId)}`] : []),
        ...azureReadOnlyLines(context.azureReadOnly),
        `Use ${shellPath(`${context.bin}/lar-work`)} for work records.`,
        ...(run
            ? [
                  'Factory run contract: read shared/orchestration.md in the supplied factory skill before doing work; lar-work role-launch gives each role its frozen target and runtime.',
                  `Verify this thread with t3_thread_configure before work and hold on a model or option mismatch: ${JSON.stringify(run.thread)}`,
                  frozenBuildMethodLine(run),
                  frozenRetroLine(run),
              ]
            : []),
        '<!-- factory-runtime:end -->',
    ].join('\n');
}

function shapeInstructions(item: Item, context: FactoryThreadContext): string {
    const decision =
        item.kind === 'decision'
            ? '\nDecision-authored builds are drafts: Brief → code evidence → Doubt → gate → Ready. Record blockers and Dependencies; do not implement during shaping.'
            : '';

    const start =
        context.earlier || context.autoBuild === undefined
            ? 'Shaping is independent of implementation. Do not build unless the user later chooses Start build.'
            : 'Shaping ends at the brief gate. Do not build here; the board starts eligible approved builds through Auto-build or a user start.';

    return `Shape ${item.id}. Read ${shellPath(context.shapeSkill)} and follow it.\n${start}${decision}\n\n${factoryEnvironment(context, true)}`;
}

/** The work message. Line 1, which T3 titles the thread from, is `Shaping` and the item's name in a sentence; then come its instructions, with its work ID. */
export function workMessage(item: Item, context: FactoryThreadContext): string {
    return `Shaping ${itemName(item)}\n${shapeInstructions(item, context)}`;
}

/** Reconcile group's message: line 1 is `Reconciling` and the group's name; then the group's work ID and the checklist to settle. */
export function reconcileMessage(item: Item, context: FactoryThreadContext): string {
    const larShape = context.shapeSkill.replace(/\/SKILL\.md$/, '');

    return `Reconciling ${itemName(item)}\nReconcile group ${item.id}. Read ${shellPath(`${larShape}/shared/reconcile-group.md`)} and follow it: run lar-work reconcile ${item.id}, then repair or resolve its items. The board already resolved items whose only changes are Status, queue order or finish time. Do not build.\n\n${factoryEnvironment(context, true)}`;
}

/** The work message boards sent before thread names carried a phase, which a launch intent still unresolved may have started. */
export function earlierWorkMessage(item: Item, context: FactoryThreadContext): string {
    return `${itemName(item)}\n${shapeInstructions(item, context)}`;
}

/**
 * The branch Start build's worktree takes: `<kind>/<n>-<slug>`, or `<kind>/<first 8 characters of the work ID>-<slug>`
 * for ticketless work, using the retained delivery Kind when present: `fix` for a bug,
 * `feat` for a feature or improvement, else `chore`. The slug is up to five words of the
 * title, lowercase and hyphen-joined, accents dropped and anything but a-z and 0-9 left out.
 */
export function buildBranch(item: Item): string {
    const kind = visibleKind(item);
    const prefix = kind === 'bug' ? 'fix' : kind === 'feature' || kind === 'improvement' ? 'feat' : 'chore';
    const words = item.title
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(/['’]/g, '')
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
        .slice(0, 5);

    return `${prefix}/${[item.number || item.id.slice(0, 8), ...words].join('-')}`;
}

/** The build message boards sent before thread names carried a phase, which a launch intent still unresolved may have started. */
export function earlierBuildMessage(item: Item, context: FactoryThreadContext): string {
    const larBuild = context.buildSkill.replace(/\/SKILL\.md$/, '');

    return `Build ${item.id}. Read ${larBuild}/agents/builder.md and follow it.\n\n${factoryEnvironment(context)}`;
}

/** Start build's message. Line 1, which T3 titles the thread from, is `Build` and the item's name in a sentence; then come the build's work ID and the builder agent of the lar-build whose entry the context names. */
export function buildMessage(item: Item, context: FactoryThreadContext): string {
    return `Build ${itemName(item)}\n${earlierBuildMessage(item, context)}`;
}

/** The board's second runtime block before runs recorded their launches. */
function earlierRunSettingsMessage(run: RunSettings): string {
    return [
        '<!-- factory-runtime:start -->',
        'Runtime contract only: never copy into product records; read run-settings for execution choices.',
        'Factory run contract: read shared/orchestration.md in the supplied factory skill before doing work.',
        `Run settings (pass this exact block and the factory environment to every child and handoff): ${JSON.stringify({ workId: run.workId, runId: run.runId, kind: run.kind, testRuntime: run.testRuntime, thread: run.thread, roles: run.roles })}`,
        frozenBuildMethodLine(run),
        frozenRetroLine(run),
        `Before work, export LAR_FACTORY_RUN_ID=${run.runId}; carry it to every child and handoff so run-test uses this frozen runtime.`,
        'Verify this thread with t3_thread_configure before work; hold on a model/option mismatch. Every role uses delegate_task and the frozen role target, including inherited targets.',
        'Read lar-work run-settings WORK_ID --run-id RUN_ID for frozen reviewer instructions. select-reviewers must use --run-id RUN_ID; record-review-round must carry runId and selection evidence.',
        '<!-- factory-runtime:end -->',
    ].join('\n');
}
