// The board's icon glossary: the design system's shared concepts plus the board's own, one icon each. Feature code
// draws a concept's icon from here, never by its lucide name.
import {
    BotIcon,
    CircleStopIcon,
    conceptIcons as sharedConceptIcons,
    FolderGit2Icon,
    ListTreeIcon,
    type LucideIcon,
    PlugIcon,
    SparklesIcon,
    SquareDashedIcon,
} from '@lar-works/design-system/icons';

/** Each concept's one icon. */
export const conceptIcons = {
    ...sharedConceptIcons,
    /** The agents that review and build, and the models they run on: Reviewers and models. A bot. */
    agents: BotIcon,
    /** Code projects (repositories). Folder with a branch. */
    projects: FolderGit2Icon,
    /** Connected services, such as issue trackers. Plug. */
    integrations: PlugIcon,
    /** Agent skills. Sparkles; nothing else takes sparkles. */
    skills: SparklesIcon,
    /** Work that was stopped before it finished, such as a stopped build: the Stopped glyph. Circle with a square;
     *  never the review eye. */
    stopped: CircleStopIcon,
    /** An item with no kind (no type label): the No kind filter and choice. Dashed square; the dashed circle is
     *  Shaping's status glyph. */
    noKind: SquareDashedIcon,
    /** Work with parts: a concept and its briefs, an issue and its sub-issues (Concepts and linked work). A list tree. */
    linkedWork: ListTreeIcon,
} as const satisfies Record<string, LucideIcon>;
