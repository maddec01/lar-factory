import type { ReactNode } from 'react';

import { Button } from '../actions/Button';
import { useDesignSystemLabels } from '../foundations/DesignSystemProvider';
import { Modal } from './Modal';

interface ActionModalProps {
    accessibleTitle?: string;
    actionColor?: 'danger' | 'primary';
    actionDisabled?: boolean;
    actionLabel: string;
    children: ReactNode;
    bodyLayout?: 'scroll' | 'fill';
    description: string;
    footerLeading?: ReactNode;
    headerActions?: ReactNode;
    loading: boolean;
    onAction: () => void;
    onClose: () => void;
    sidebar?: ReactNode;
    noValidate?: boolean;
    title: string;
}

export function ActionModal({
    accessibleTitle,
    actionColor = 'primary',
    actionDisabled = false,
    actionLabel,
    children,
    bodyLayout,
    description,
    footerLeading,
    headerActions,
    loading,
    onAction,
    onClose,
    sidebar,
    noValidate,
    title,
}: ActionModalProps) {
    const labels = useDesignSystemLabels();

    return (
        <Modal loading={loading} onClose={onClose}>
            <Modal.Content
                title={title}
                accessibleTitle={accessibleTitle}
                description={description}
                sidebar={sidebar}
                headerActions={headerActions}
            >
                <Modal.Form
                    noValidate={noValidate}
                    onSubmit={(event) => {
                        event.preventDefault();

                        if (!loading && !actionDisabled) {
                            onAction();
                        }
                    }}
                >
                    <Modal.Body layout={bodyLayout}>{children}</Modal.Body>
                    <Modal.Footer leading={footerLeading}>
                        <Button type="button" disabled={loading} onClick={onClose} variant="secondary">
                            {labels.cancel}
                        </Button>
                        <Button
                            type="submit"
                            loading={loading}
                            disabled={loading || actionDisabled}
                            variant={actionColor === 'danger' ? 'destructive' : 'primary'}
                        >
                            {actionLabel}
                        </Button>
                    </Modal.Footer>
                </Modal.Form>
            </Modal.Content>
        </Modal>
    );
}
