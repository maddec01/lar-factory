// The board's UI layer: its compositions of the design system's components, its icon glossary and its kind badge.
export {
    AddItemButton,
    CreateIssueChoice,
    DraftFields,
    DraftTicketPart,
    PanelField,
    TicketSearch,
    TicketSearchPane,
} from './AddItem';
export { ActionStack, SettingConfirm, SettingLastRun } from './Archive';
export { BoardContent, BoardShell, ReadingLine } from './BoardShell';
export { BoardBrand, BoardTitleBar, type RefreshHealth, RefreshIndicator } from './BoardTitleBar';
export { buttonKind } from './ButtonKinds';
export {
    BoardCounter,
    BoardCounters,
    CounterAge,
    CounterDash,
    CounterDivider,
    CounterEmpty,
    CounterFigure,
    CounterGroup,
    CounterGroups,
    CounterItem,
    CounterList,
    CounterOfLimit,
    CounterPartial,
} from './Counters';
export { DeskCard, DeskHint, DeskSection } from './Desk';
export { FilterBar, FilterChip, FilterChoice, FilterChoices, FilterMenu } from './Filters';
export { ListButton, ListGroupItem, ListHeader, ListItemRow, ListNote } from './List';
export { LoadingScreen } from './LoadingScreen';
export { ReleaseNotes, UpdateDownloading, UpdatePill } from './UpdatePill';
export { BoardWarning, BoardWarnings, ToolMissing } from './Warnings';
export { ActivityLine, AgentAge, AgentList, AgentRow, WorkingAgents } from './ActivityLine';
export { ActivityTrack } from './ActivityTrack';
export {
    AttentionEntry,
    BoardAttentionList,
    AttentionMark,
    AttentionNone,
    EntryButton,
    PartLink,
    PartName,
    RefButton,
} from './Attention';
export { LossList } from './Cleanup';
export { DependencyItem, DependencyList } from './Dependencies';
export {
    DossierBody,
    DossierChips,
    type DossierChipTone,
    DossierFields,
    DossierLine,
    DossierList,
    DossierNext,
    DossierNote,
    DossierRepos,
    DossierRow,
    DossierTitle,
    DossierTitleCell,
    DossierToggle,
    DossierTools,
    PartsBar,
    PlanningNote,
} from './Dossier';
export { ItemFields, ItemTitle, RepoIdentity, TitleLink } from './ItemParts';
export { NeedsYouNotice, NeedsYouResult } from './NeedsYou';
export { PartKindLabel, PartRow, PartsList, PartTrack, PartWaits, ShowDoneToggle, ThreadLine } from './PartsList';
export {
    ChecksState,
    PullRequestList,
    PullRequestReadiness,
    PullRequestRef,
    PullRequestRow,
    PullRequestState,
    ReadinessDetails,
} from './PullRequests';
export { SliceBar, SliceList, SliceRow } from './Slices';
export { SourceIcon } from './SourceIcon';
export { BuildLimit, HeaderSwitch, StageList, StagePane, StagePaneEmpty, StageSections } from './StagePane';
export {
    OnYourDesk,
    QueueAge,
    QueuePlace,
    RowBlocked,
    RowCells,
    RowCount,
    RowFirst,
    RowFoot,
    RowGlyph,
    RowIdentity,
    RowKindCell,
    RowOpen,
    RowPartOf,
    RowSecondLine,
    RowSide,
    RowSliceNote,
    RowSliceToggle,
    RowSlices,
    RowState,
    RowStateCell,
    RowTitle,
    RowTitleCell,
    StageRowItem,
    UsageFigures,
} from './StageRow';
export { StageTrack } from './StageTrack';
export { ActionError, StartGroup, StartLine, StartNote, StartTag } from './StartControls';
export { boardColor, boardStatusState, sliceProgressLabel, stageColor, statusColor } from './StatusColors';
export { StatusGlyph, StatusGlyphSlot } from './StatusGlyph';
export { EarlierThread, EarlierThreadList } from './Threads';
export {
    HistoryRow,
    MapBand,
    MapCanvas,
    MapCheckNode,
    MapEdgeLabel,
    MapEdges,
    MapHistoryGroup,
    MapHistoryList,
    MapLaneName,
    MapNode,
    MapPartNode,
    WorkMapFrame,
} from './WorkMap';
export {
    AccessNotice,
    DialogActions,
    ItemDialogAside,
    ItemDialogBody,
    ItemDialogColumns,
    ItemSummary,
    SummaryBlocked,
    SummaryPanel,
    SummaryParent,
    SummaryStatus,
    WarningNote,
} from './ItemDialog';
export {
    AttachmentLink,
    ChangeFailed,
    CheckRun,
    ChipGroup,
    DetailFact,
    DetailsHeading,
    DetailsSection,
    EditActions,
    EditorSlot,
    FactList,
    FocusPanel,
    HeaderStatus,
    InlineList,
    KindQuestion,
    LabelEditorPanel,
    MainColumnSlot,
    MainSection,
    MetaArea,
    OutgoingTicket,
    SectionHeader,
    SpecSync,
    SprintCount,
    TextSection,
    TicketLink,
    TicketLinkList,
    WaitsOnList,
} from './ItemDetails';
export {
    ItemProgressPanel,
    PartsProgress,
    ProgressActivity,
    ProgressCount,
    SliceChip,
    SliceChips,
    WorkflowSteps,
} from './ItemProgress';
export { ProjectIcon, type ProjectIconSize, type ProjectIconSource } from './ProjectIcon';
export {
    OpenSettingsButton,
    ProjectValueList,
    ReasonNote,
    SettingControl,
    SettingDetails,
    SettingsNote,
} from './Settings';
export { CreateLabelForm, TrackerLabelEditor, TrackerLabelList, TrackerLabelRow } from './TrackerLabels';
export { VocabularyMore, VocabularyRow, VocabularySuggestion } from './Vocabulary';
export {
    AddFolderLine,
    ChoiceDetails,
    EmptyBoard,
    ProjectLine,
    ProjectList,
    ProjectListItem,
    SetupCardList,
    SetupHeader,
    SetupStep,
} from './Onboarding';
export { conceptIcons } from './ConceptIcons';
export { KindBadge } from './KindBadge';
