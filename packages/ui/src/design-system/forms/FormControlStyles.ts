export const formControlDefaults = { size: 'sm', variant: 'filled', color: 'primary' } as const;

export const formControlBorderClasses = 'border border-base-400/80 dark:border-base-400';

export const formChoiceClasses = `${formControlBorderClasses} bg-base-100 shadow-xs/5 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/20 disabled:cursor-default disabled:opacity-50 dark:bg-base-400/30`;

/** T3 Code's input: an 8px-radius field on the card surface with a hairline input border, a faint shadow and a
 *  3px primary ring while focused. */
export const formControlClasses = `min-w-0 rounded-md ${formControlBorderClasses} bg-base-100 text-base-content shadow-xs/5 placeholder:text-base-700 data-placeholder:text-base-700 focus:border-primary focus:bg-base-100 focus:ring-[3px] focus:ring-primary/20 dark:bg-base-400/30 dark:focus:bg-base-400/30 data-invalid:border-danger/60 data-invalid:bg-base-100 aria-invalid:border-danger/60 aria-invalid:bg-base-100 data-invalid:focus:ring-danger/16 aria-invalid:focus:ring-danger/16`;
