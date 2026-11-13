import {
    Alert,
    Button,
    Field,
    Input,
    OptionSelect,
    SettingsGroup,
    SettingsRow,
    Stack,
    Text,
    Textarea,
} from '@lar-works/design-system';
import type { ReactNode } from 'react';

export function FactorySettingsLayout({
    children,
    busy,
    problem,
}: {
    children: ReactNode;
    busy?: boolean;
    problem?: string | null;
}) {
    return (
        <fieldset className="factory-settings" disabled={busy}>
            <Stack space="section">
                {problem && <Alert tone="danger">{problem}</Alert>}
                {children}
            </Stack>
        </fieldset>
    );
}

export function FactorySettingsNotice({ children, retry }: { children: ReactNode; retry?: () => void }) {
    return (
        <Stack space="related">
            <Text>{children}</Text>
            {retry && (
                <Button variant="secondary" onClick={retry}>
                    Try again
                </Button>
            )}
        </Stack>
    );
}

export function FactorySettingsGroup({
    title,
    description,
    children,
    action,
}: {
    title: string;
    description?: string;
    children: ReactNode;
    action?: ReactNode;
}) {
    return (
        <SettingsGroup title={title} description={description} action={action}>
            {children}
        </SettingsGroup>
    );
}

export function FactoryChoice({
    label,
    value,
    options,
    onChange,
    description,
}: {
    label: string;
    value: string;
    options: { value: string; label: string; disabled?: boolean }[];
    onChange: (value: string) => void;
    description?: string;
}) {
    return (
        <SettingsRow label={label} description={description}>
            <OptionSelect label={label} presentation="setting" value={value} options={options} onChange={onChange} />
        </SettingsRow>
    );
}

export function FactoryText({
    label,
    value,
    onChange,
    multiline,
    readOnly,
    autoFocus,
    description,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    multiline?: boolean;
    readOnly?: boolean;
    autoFocus?: boolean;
    description?: string;
}) {
    return (
        <SettingsRow
            label={multiline ? undefined : label}
            description={multiline ? undefined : description}
            below={
                multiline ? (
                    <Field label={label} helperText={description}>
                        <Textarea
                            readOnly={readOnly}
                            rows={6}
                            value={value}
                            onChange={(event) => onChange(event.target.value)}
                        />
                    </Field>
                ) : undefined
            }
        >
            {!multiline && (
                <Input
                    autoFocus={autoFocus}
                    readOnly={readOnly}
                    aria-label={label}
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                />
            )}
        </SettingsRow>
    );
}

export function FactoryAction({
    children,
    onClick,
    disabled,
}: {
    children: ReactNode;
    onClick: () => void;
    disabled?: boolean;
}) {
    return (
        <Button variant="secondary" disabled={disabled} onClick={onClick}>
            {children}
        </Button>
    );
}

export function FactoryActions({ children, note }: { children: ReactNode; note?: string }) {
    return <SettingsRow label={note} below={<div className="factory-settings-actions">{children}</div>} />;
}
