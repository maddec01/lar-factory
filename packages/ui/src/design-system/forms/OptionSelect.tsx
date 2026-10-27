import { SkeletonLoader } from '../feedback/SkeletonLoader';
import { Select, SelectItem } from './Select';

interface LoadedOptionSelectProps<Value extends string> {
    disabled?: boolean;
    label: string;
    loading?: false;
    onChange: (value: Value) => void;
    /** Disabled options stay visible but cannot be chosen. */
    options: readonly { label: string; value: Value; disabled?: boolean }[];
    value: Value;
}

interface LoadingOptionSelectProps {
    label: string;
    loading: true;
}

type OptionSelectProps<Value extends string> = LoadedOptionSelectProps<Value> | LoadingOptionSelectProps;

export function OptionSelect<Value extends string>(props: OptionSelectProps<Value>) {
    if (props.loading)
        return (
            <SkeletonLoader label={props.label}>
                <SkeletonLoader.Shape presentation="control" />
            </SkeletonLoader>
        );

    const { disabled, label, onChange, options, value } = props;

    return (
        <Select
            aria-label={label}
            disabled={disabled}
            value={value}
            onValueChange={(next) => {
                const option = options.find((candidate) => candidate.value === next);

                if (option) onChange(option.value);
            }}
        >
            {options.map((option) => (
                <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                    {option.label}
                </SelectItem>
            ))}
        </Select>
    );
}
