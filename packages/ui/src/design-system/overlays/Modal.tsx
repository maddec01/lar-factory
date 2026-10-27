/* eslint-disable react-refresh/only-export-components -- Compound members are exported through Modal. */

import {
    Modal as NinnaModal,
    type ModalBodyProps,
    type ModalContentProps,
    type ModalFooterProps,
} from '@ninna-ui/overlays';
import {
    type ComponentProps,
    createContext,
    forwardRef,
    type ReactNode,
    type Ref,
    useCallback,
    useContext,
} from 'react';

import { IconButton } from '../actions/IconButton';
import { useDesignSystemLabels } from '../foundations/DesignSystemProvider';
import { CloseIcon } from '../icons/NavigationIcons';
import { Heading, Text } from '../typography/Typography';
import { useModalAutoFocus } from './useModalAutoFocus';
import { useScrollFade } from './useScrollFade';

const ModalLoadingContext = createContext(false);

interface ModalContentPolicyProps extends Omit<ModalContentProps, 'className' | 'size' | 'title'> {
    accessibleTitle?: string;
    /** Whether opening focuses the first editable field; off while the caller focuses something else. */
    focusFirstField?: boolean;
    headerActions?: ReactNode;
    sidebar?: ReactNode;
    /** The dialog's size; a dialog with a sidebar is `paned` unless it says otherwise. */
    presentation?: 'default' | 'paned' | 'workspace';
    title: string;
}

const ModalContent = forwardRef<HTMLDivElement, ModalContentPolicyProps>(
    (
        {
            accessibleTitle,
            children,
            closeOnEscape,
            closeOnOverlayClick,
            description,
            focusFirstField,
            headerActions,
            onPointerDownOutside,
            sidebar,
            presentation = sidebar ? 'paned' : 'default',
            title,
            ...props
        },
        ref,
    ) => {
        const loading = useContext(ModalLoadingContext);
        const focusProps = useModalAutoFocus(focusFirstField);

        return (
            <NinnaModal.Content
                ref={ref}
                {...props}
                {...focusProps}
                title={accessibleTitle ?? title}
                description={description}
                closeOnEscape={loading ? false : closeOnEscape}
                closeOnOverlayClick={loading ? false : closeOnOverlayClick}
                onPointerDownOutside={(event) => {
                    if (event.target instanceof Element && event.target.closest('[data-slot="toaster"]')) {
                        event.preventDefault();
                    }

                    onPointerDownOutside?.(event);
                }}
                size={presentation === 'workspace' ? 'full' : undefined}
                className={`flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] flex-col overflow-hidden sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] ${
                    sidebar ? 'md:grid md:grid-cols-[14rem_minmax(0,1fr)] md:grid-rows-[auto_minmax(0,1fr)]' : ''
                } ${
                    presentation === 'workspace'
                        ? 'h-[calc(100dvh-1rem)] max-w-6xl sm:h-[calc(100dvh-2rem)] sm:max-w-6xl'
                        : presentation === 'paned'
                          ? // Paned dialogs keep one height across panes; the body scrolls instead of the dialog resizing.
                            'h-[calc(100dvh-1rem)] max-w-4xl sm:h-[min(44rem,calc(100dvh-2rem))] sm:max-w-4xl'
                          : 'max-w-160 sm:max-w-160'
                }`}
            >
                <header
                    data-slot="modal-header"
                    className={`@container min-w-0 shrink-0 px-5 pt-5 sm:px-6 sm:pt-6 ${
                        description ? (sidebar ? 'pb-4 md:pb-0' : '') : 'pb-4'
                    } ${sidebar ? 'md:col-start-2 md:row-start-1' : ''}`}
                >
                    <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-3">
                        <Heading as="h2" className="min-w-0 flex-1 wrap-break-word" variant="section">
                            {title}
                        </Heading>
                        {headerActions ? (
                            <div className="order-3 flex basis-full items-center justify-end gap-2 @min-[32rem]:order-0 @min-[32rem]:ml-auto @min-[32rem]:basis-auto">
                                {headerActions}
                            </div>
                        ) : null}
                        <div className="shrink-0">
                            <ModalClose />
                        </div>
                    </div>
                </header>
                {sidebar ? (
                    <div className="min-h-0 min-w-0 shrink-0 md:col-start-1 md:row-span-2 md:row-start-1">
                        {sidebar}
                    </div>
                ) : null}
                <div
                    className={`flex min-h-0 min-w-0 flex-1 flex-col ${sidebar ? 'md:col-start-2 md:row-start-2' : ''}`}
                >
                    {description ? (
                        <Text
                            className={`shrink-0 px-5 pb-4 sm:px-6 ${sidebar ? 'pt-4 md:pt-2' : 'pt-2'}`}
                            tone="muted"
                        >
                            {description}
                        </Text>
                    ) : null}
                    {children}
                </div>
            </NinnaModal.Content>
        );
    },
);

ModalContent.displayName = 'Modal.Content';

const ModalBody = forwardRef<HTMLDivElement, Omit<ModalBodyProps, 'className'> & { layout?: 'scroll' | 'fill' }>(
    ({ layout = 'scroll', children, ...props }, ref: Ref<HTMLDivElement>) => {
        const { setViewport, setContent, className } = useScrollFade();
        const bodyRef = useCallback(
            (element: HTMLDivElement) => {
                setViewport(element);

                const cleanup = typeof ref === 'function' ? ref(element) : undefined;

                if (ref && typeof ref !== 'function') ref.current = element;

                return () => {
                    setViewport(null);

                    if (typeof cleanup === 'function') cleanup();
                    else if (typeof ref === 'function') ref(null);
                    else if (ref) ref.current = null;
                };
            },
            [ref, setViewport],
        );

        return (
            <NinnaModal.Body
                ref={bodyRef}
                {...props}
                className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 pt-2 sm:px-6 ${layout === 'fill' ? 'flex flex-col' : ''} ${className}`}
            >
                <div
                    ref={setContent}
                    className={layout === 'fill' ? 'flex min-h-0 flex-1 flex-col gap-3' : 'flow-root'}
                >
                    {children}
                </div>
            </NinnaModal.Body>
        );
    },
);

ModalBody.displayName = 'Modal.Body';

function ModalForm(props: Omit<ComponentProps<'form'>, 'className'>) {
    return <form {...props} className="flex min-h-0 flex-1 flex-col" />;
}

function ModalPane({ active, children }: { active: boolean; children: ReactNode }) {
    return (
        <div hidden={!active} className={active ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
            {children}
        </div>
    );
}

const ModalFooter = forwardRef<HTMLDivElement, Omit<ModalFooterProps, 'className'> & { leading?: ReactNode }>(
    ({ leading, children, ...props }, ref) => (
        <NinnaModal.Footer
            ref={ref}
            {...props}
            className="shrink-0 border-t border-base-300 bg-base-50/60 px-5 py-4 sm:px-6 sm:pb-4"
        >
            {leading ? <div className="mr-auto min-w-0 basis-full pb-2 sm:basis-auto sm:pb-0">{leading}</div> : null}
            {children}
        </NinnaModal.Footer>
    ),
);

ModalFooter.displayName = 'Modal.Footer';

function ModalClose() {
    const labels = useDesignSystemLabels();
    const loading = useContext(ModalLoadingContext);

    return (
        <NinnaModal.Close asChild>
            <IconButton aria-label={labels.close} disabled={loading} icon={<CloseIcon />} variant="header" />
        </NinnaModal.Close>
    );
}

interface ModalRootPolicyProps {
    children: ReactNode;
    loading?: boolean;
    onClose: () => void;
}

function ModalRoot({ children, loading = false, onClose }: ModalRootPolicyProps) {
    return (
        <ModalLoadingContext.Provider value={loading}>
            <NinnaModal open onOpenChange={(open) => !open && !loading && onClose()}>
                {children}
            </NinnaModal>
        </ModalLoadingContext.Provider>
    );
}

export const Modal = Object.assign(ModalRoot, {
    Body: ModalBody,
    Form: ModalForm,
    Pane: ModalPane,
    Content: ModalContent,
    Footer: ModalFooter,
});
