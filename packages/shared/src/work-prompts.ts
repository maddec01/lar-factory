// Instructions sent to work threads; separate from board copy.

import type { ModelSelection } from './board-domain.ts';
import { type Item } from './domain.ts';
import { itemName } from './presentation.ts';
import type { RunSettings } from './run-settings.ts';

export interface FactoryThreadContext {
    dataDir: string;
    bin: string;
    shapeSkill: string;
    buildSkill: string;
    azureReadOnly?: boolean;
    delegationModel?: ModelSelection;
}

const shellPath = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

function factoryEnvironment(context: FactoryThreadContext): string {
    return [
        'Use the factory installation and data folder below for this thread and every subagent.',
        'Before running any factory command, set this environment in that command shell:',
        `export LAR_FACTORY_DATA_DIR=${shellPath(context.dataDir)}`,
        `export PATH=${shellPath(context.bin)}:"$PATH"`,
        `export LAR_FACTORY_BIN=${shellPath(context.bin)}`,
        `export LAR_FACTORY_SHAPE_SKILL=${shellPath(context.shapeSkill)}`,
        `export LAR_FACTORY_BUILD_SKILL=${shellPath(context.buildSkill)}`,
        ...(context.azureReadOnly
            ? [
                  "export LAR_FACTORY_AZURE_READ_ONLY='1'",
                  'All Azure DevOps organizations are read-only. Never launch Azure implementation or write through another tool.',
              ]
            : []),
        `Use ${shellPath(`${context.bin}/lar-work`)} for work records. Never use another data folder or command installation.`,
        `Factory skill entries: ${JSON.stringify({ 'lar-shape': context.shapeSkill, 'lar-build': context.buildSkill })}`,
        'Pass these exact skill entries and the CLI/data environment above verbatim in every child task prompt and handoff, including Explore and Approver. Children must read the supplied entry for their role first and resolve its relative files from that entry; never discover skills independently or read a global installation first. If a supplied entry is unavailable, hold and report its exact path.',
        'The target repository needs no factory files or factory instructions in AGENTS.md or CLAUDE.md.',
        ...(context.delegationModel
            ? [
                  `Default every delegated role to this T3 target unless this run explicitly supplies a role override: ${JSON.stringify({ providerInstanceId: context.delegationModel.instanceId, model: context.delegationModel.model, options: Object.fromEntries(context.delegationModel.options?.map(({ id, value }) => [id, value]) ?? []) })}. Pass this default to every delegated task.`,
              ]
            : []),
    ].join('\n');
}

function shapeInstructions(item: Item, context?: FactoryThreadContext | null): string {
    if (!context) return `$lar-shape ${item.id}`;

    return `Shape ${item.id}. Read ${shellPath(context.shapeSkill)} and follow it.\nShaping is independent of implementation. Do not build unless the user later chooses Start build.\n\n${factoryEnvironment(context)}`;
}

/** The work message. Line 1, which T3 titles the thread from, is `Shaping` and the item's name in a sentence; then come its instructions, with its work ID. */
export function workMessage(item: Item, context?: FactoryThreadContext | null): string {
    return `Shaping ${itemName(item)}\n${shapeInstructions(item, context)}`;
}

/** The work message boards sent before thread names carried a phase, which a launch intent still unresolved may have started. */
export function earlierWorkMessage(item: Item, context?: FactoryThreadContext | null): string {
    return `${itemName(item)}\n${shapeInstructions(item, context)}`;
}

/**
 * The branch Start build's worktree takes: `<kind>/<n>-<slug>`, or `<kind>/<first 8 characters of the work ID>-<slug>`
 * for ticketless work, the kind `fix` for a bug,
 * `feat` for a feature or improvement, else `chore`. The slug is up to five words of the
 * title, lowercase and hyphen-joined, accents dropped and anything but a-z and 0-9 left out.
 */
export function buildBranch(item: Item): string {
    const { kind } = item;
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
export function earlierBuildMessage(item: Item, larBuild: string, context?: FactoryThreadContext | null): string {
    const message = `Build ${item.id}. Read ${larBuild}/agents/builder.md and follow it.`;

    return context ? `${message}\n\n${factoryEnvironment(context)}` : message;
}

/** Start build's message. Line 1, which T3 titles the thread from, is `Build` and the item's name in a sentence; then come the build's work ID and the builder agent of the lar-build installed at `larBuild`. */
export function buildMessage(item: Item, larBuild: string, context?: FactoryThreadContext | null): string {
    return `Build ${itemName(item)}\n${earlierBuildMessage(item, larBuild, context)}`;
}

/** The snapshot is authoritative across compaction, retries and handoff; no live Settings are consulted by roles. */
export function runSettingsMessage(run: RunSettings): string {
    return [
        'Factory run contract: read shared/orchestration.md in the supplied factory skill before doing work.',
        `Run settings (pass this exact block and the factory environment to every child and handoff): ${JSON.stringify({ workId: run.workId, runId: run.runId, kind: run.kind, thread: run.thread, roles: run.roles })}`,
        'Verify this thread with t3_thread_configure before work; hold on a model/option mismatch. Every role uses delegate_task and the frozen role target, including inherited targets.',
        'Read lar-work run-settings WORK_ID --run-id RUN_ID for frozen reviewer instructions. select-reviewers must use --run-id RUN_ID; record-review-round must carry runId and selection evidence.',
    ].join('\n');
}
