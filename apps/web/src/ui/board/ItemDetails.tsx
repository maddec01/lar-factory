// Item detail compositions. Public imports remain stable; implementations live in focused modules.
export {
    AddDescription,
    DetailsSection,
    TextSection,
    MainSection,
    SectionHeader,
    HeaderStatus,
    DetailsLoading,
} from './ItemDetailSections';
export { MetaArea, DetailFact, InlineList, FactList, SprintCount, WaitsOnList, ChipGroup } from './ItemDetailFacts';
export {
    EditorSlot,
    EditActions,
    SpecSync,
    ChangeFailed,
    KindQuestion,
    OutgoingTicket,
    CheckRun,
    FocusPanel,
} from './ItemDetailEditing';
export { TicketLinkList, TicketLink, TicketLinkPlaceholders, AttachmentLink } from './ItemDetailLinks';
