// What an onboarding step shows while what it needs is still loading.

import { Alert, Button, Loading } from '@lar-works/design-system';

import { useWizardStore } from './WizardStore';
import { buttonKind } from '@/ui/board';

export function Pending({ children }: { children: string }) {
    return <Loading presentation="status" label={children} />;
}

export function DetectionPending() {
    const { detection, detect } = useWizardStore();

    return detection?.state === 'failed' ? (
        <Alert
            role={detection.code === 'sample-mode' ? 'status' : 'alert'}
            aria-live={detection.code === 'sample-mode' ? 'polite' : 'assertive'}
            tone={detection.code === 'sample-mode' ? 'info' : 'danger'}
            title={detection.code === 'sample-mode' ? 'Sample mode' : 'Couldn’t check the repository'}
            action={
                detection.code !== 'sample-mode' && (
                    <Button {...buttonKind('other')} onClick={() => void detect()}>
                        Try again
                    </Button>
                )
            }
        >
            {detection.error}
        </Alert>
    ) : (
        <Pending>Checking the repository and your access…</Pending>
    );
}
