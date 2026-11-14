import { DEPENDENCY_STATUS_NOTICE } from '@lar-factory/shared';
import { Alert, Text } from '@lar-works/design-system';

/** Current delivery facts alongside a byte-bound retained brief or Spec. */
export function BriefDependencyStatus({ rows }: { rows: { id: string; text: string }[] }) {
    return (
        <Alert tone="info" size="sm" title="Current dependency status">
            <Text>{DEPENDENCY_STATUS_NOTICE}</Text>
            {rows.map((row) => (
                <Text key={row.id} breaks>
                    {row.text}
                </Text>
            ))}
        </Alert>
    );
}
