import { HUMAN_ROLE_TEXT, isHumanRole, type ReleasePlan } from './release-plan.ts';

/** Legacy owner notice from S05, deliberately separate from the T3 question classifier. */
export function legacyReleaseNoticeStep(plan: ReleasePlan | null, notice: string | null) {
    const id =
        notice &&
        new RegExp(String.raw`^Release step ([\w-]+) awaits ${HUMAN_ROLE_TEXT} in the board\.`).exec(notice)?.[1];

    if (!id) return undefined;

    // The full legacy template contains no independent question. Never infer a link from a passing mention.
    const template = new RegExp(
        String.raw`^Release step [\w-]+ awaits ${HUMAN_ROLE_TEXT} in the board\. Inspect the staged manifest \/[^\s,]+, SHA256 [a-f0-9]{64}, and approve only these exact three repository\/PR\/merged-SHA artifacts together\. stage-merged-manifest has its actual Agent receipt; do not repeat staging\. No ${HUMAN_ROLE_TEXT} activation receipt is recorded\. After board approval, resume In progress in this same owner for activate-local-artifacts against this manifest, then actual composition\/version-rejection\/legacy Outcome\. Activation and Outcome are still pending\.$`,
    );

    return template.test(notice!) ? plan?.steps.find((step) => step.id === id && isHumanRole(step.who)) : undefined;
}

export const receiptMatchesNotice = (evidence: string, notice: string) =>
    (notice.match(/\b[a-f0-9]{40,64}\b/gi) ?? []).every((pin) => evidence.toLowerCase().includes(pin.toLowerCase()));
