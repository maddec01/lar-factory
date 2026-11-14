// Item detail compositions. Public imports remain stable; implementations live in focused modules.
export {
    AddDescription,
    DetailsSection,
    TextSection,
    MainSection,
    SectionHeader,
    HeaderStatus,
    MainColumnSlot,
} from './ItemDetailSections';
export { MetaArea, DetailFact, InlineList, FactList, SprintCount, WaitsOnList, ChipGroup } from './ItemDetailFacts';
export {
    EditorSlot,
    EditActions,
    SpecSync,
    LabelEditorPanel,
    ChangeFailed,
    KindQuestion,
    OutgoingTicket,
    CheckRun,
    FocusPanel,
} from './ItemDetailEditing';
export { TicketLinkList, TicketLink, AttachmentLink } from './ItemDetailLinks';
