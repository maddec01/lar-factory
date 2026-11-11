// Link to Project onboarding instructions.
import { InlineLink } from '@lar-works/design-system';

const README = 'https://github.com/maddec01/lar-factory/blob/main/README.md#get-started';

/** A short link to the project setup instructions. */
export function AddingARepository() {
    return (
        <>
            Read <InlineLink href={README}>how to add a project</InlineLink>.
        </>
    );
}
