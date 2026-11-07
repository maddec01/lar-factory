// What an onboarding step shows while what it needs is still loading.

import { Alert, Button, buttonKind, Spinner } from '@lar-works/design-system';

import { useWizardStore } from './WizardStore';

export function Pending({ children }: { children: string }) {
    return <Spinner presentation="status" label={children} />;
}

export function DetectionPending() {
    const { detection, detect } = useWizardStore();

    return detection?.state === 'failed' ? (
        <Alert
            tone="danger"
            title="Could not check the repository"
            action={
                <Button {...buttonKind('other')} onClick={() => void detect()}>
                    Retry
                </Button>
            }
        >
            {detection.error}
        </Alert>
    ) : (
        <Pending>Checking the repository and your access…</Pending>
    );
}
