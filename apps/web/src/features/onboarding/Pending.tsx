// What an onboarding step shows while what it needs is still loading.

import { Alert, Button, buttonKind, SpinnerIcon } from '@lar-works/design-system';

import { useWizardStore } from './WizardStore';

export function Pending({ children }: { children: React.ReactNode }) {
    return (
        <p role="status" className="text-base-700 m-0 flex items-center gap-2 py-4 text-sm">
            <SpinnerIcon motion="always" className="size-4" />
            {children}
        </p>
    );
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
