import { Disclosure, Stack, Text } from '@lar-works/design-system';

export function BriefApprovalDetails({
    briefs,
    digest,
}: {
    briefs: { workId: string; title: string; approvalDigest: string }[];
    digest: string;
}) {
    return (
        <Disclosure label="Approval details" presentation="section">
            <Stack space="tight">
                {briefs.map((brief) => (
                    <Stack key={brief.workId} space="tight">
                        <Text variant="caption">{brief.title}</Text>
                        <Text variant="caption" breaks>
                            Approval digest: {brief.approvalDigest}
                        </Text>
                    </Stack>
                ))}
                <Text variant="caption" breaks>
                    Batch digest: {digest}
                </Text>
            </Stack>
        </Disclosure>
    );
}
