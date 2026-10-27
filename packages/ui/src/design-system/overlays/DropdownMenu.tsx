/* eslint-disable react-refresh/only-export-components -- Compound members are exported through DropdownMenu. */

import {
    DropdownMenu as NinnaDropdownMenu,
    type DropdownMenuContentProps,
    type DropdownMenuItemProps,
    type DropdownMenuLabelProps,
    type DropdownMenuRadioGroupProps,
    type DropdownMenuRadioItemProps,
} from '@ninna-ui/overlays';
import { type ComponentProps, forwardRef } from 'react';

interface DropdownMenuContentPolicyProps extends Omit<DropdownMenuContentProps, 'className'> {
    width?: 'sm' | 'md';
}

const contentWidthClasses: Record<NonNullable<DropdownMenuContentPolicyProps['width']>, string> = {
    sm: 'w-60',
    md: 'w-64',
};

const DropdownMenuContent = forwardRef<HTMLDivElement, DropdownMenuContentPolicyProps>(
    ({ side = 'bottom', sideOffset = 8, width = 'sm', ...props }, ref) => (
        <NinnaDropdownMenu.Content
            ref={ref}
            side={side}
            sideOffset={sideOffset}
            {...props}
            className={`${contentWidthClasses[width]} max-w-[calc(100vw-2rem)] max-h-(--radix-dropdown-menu-content-available-height) overflow-y-auto`}
        />
    ),
);

DropdownMenuContent.displayName = 'DropdownMenu.Content';

interface DropdownMenuLabelPolicyProps extends Omit<DropdownMenuLabelProps, 'className'> {
    presentation?: 'section' | 'identity';
}

const DropdownMenuLabel = forwardRef<HTMLDivElement, DropdownMenuLabelPolicyProps>(
    ({ presentation = 'section', ...props }, ref) => (
        <NinnaDropdownMenu.Label
            ref={ref}
            {...props}
            className={presentation === 'identity' ? 'normal-case tracking-normal' : undefined}
        />
    ),
);

DropdownMenuLabel.displayName = 'DropdownMenu.Label';

interface DropdownMenuItemPolicyProps extends Omit<DropdownMenuItemProps, 'className'> {
    /** Forward the underlying menu item's behavior to a link without a second tab stop. */
    asChild?: boolean;
}

const DropdownMenuItem = forwardRef<HTMLDivElement, DropdownMenuItemPolicyProps>((props, ref) => (
    <NinnaDropdownMenu.Item
        ref={ref}
        {...props}
        className="max-lg:min-h-11 pointer-coarse:min-h-11 [&>svg]:size-4 [&>svg]:shrink-0 aria-[current=page]:bg-primary/10 aria-[current=page]:text-primary"
    />
));

DropdownMenuItem.displayName = 'DropdownMenu.Item';

interface DropdownMenuRadioGroupPolicyProps extends Omit<DropdownMenuRadioGroupProps, 'className'> {
    presentation?: 'default' | 'segmented';
}

const DropdownMenuRadioGroup = forwardRef<HTMLDivElement, DropdownMenuRadioGroupPolicyProps>(
    ({ presentation = 'default', ...props }, ref) => (
        <NinnaDropdownMenu.RadioGroup
            ref={ref}
            {...props}
            className={presentation === 'segmented' ? 'flex gap-0.5 rounded-lg bg-base-200/70 p-0.5' : undefined}
        />
    ),
);

DropdownMenuRadioGroup.displayName = 'DropdownMenu.RadioGroup';

interface DropdownMenuRadioItemPolicyProps extends Omit<DropdownMenuRadioItemProps, 'className'> {
    presentation?: 'default' | 'segmented';
}

const DropdownMenuRadioItem = forwardRef<HTMLDivElement, DropdownMenuRadioItemPolicyProps>(
    ({ onSelect, presentation = 'default', ...props }, ref) => (
        <NinnaDropdownMenu.RadioItem
            ref={ref}
            {...props}
            data-presentation={presentation}
            onSelect={
                presentation === 'segmented'
                    ? (event) => {
                          event.preventDefault();
                          onSelect?.(event);
                      }
                    : onSelect
            }
            className={
                presentation === 'segmented'
                    ? 'size-7 justify-center rounded-md p-0 text-base-600 focus:bg-base-300 focus:text-base-content data-[state=checked]:bg-base-100 data-[state=checked]:text-base-content data-[state=checked]:shadow-sm [&>span]:hidden [&>svg]:size-4'
                    : 'max-lg:min-h-11 pointer-coarse:min-h-11 [&>svg]:size-4 [&>svg]:shrink-0'
            }
        />
    ),
);

DropdownMenuRadioItem.displayName = 'DropdownMenu.RadioItem';

function DropdownMenuRoot(props: ComponentProps<typeof NinnaDropdownMenu>) {
    return <NinnaDropdownMenu {...props} />;
}

export const DropdownMenu = Object.assign(DropdownMenuRoot, NinnaDropdownMenu, {
    Content: DropdownMenuContent,
    Item: DropdownMenuItem,
    Label: DropdownMenuLabel,
    RadioGroup: DropdownMenuRadioGroup,
    RadioItem: DropdownMenuRadioItem,
});
