// The board's UI layer: its compositions of the design system's components, its icon glossary and its kind badge.
export { WaitWord } from './Attention';
export {
    AddItemButton,
    CreateIssueChoice,
    AddItemModes,
    DraftFields,
    DraftTicketPart,
    PanelField,
    PanelPicker,
    TicketSearch,
    TicketSearchPane,
} from './AddItem';
export { ActionStack, ArchiveLine, SettingConfirm, SettingLastRun } from './Archive';
export { scrollBoardToTop } from './BoardScroll';
export { BoardContent, BoardShell, ReadingLine } from './BoardShell';
export { BoardTitleBar, type RefreshHealth, RefreshIndicator } from './BoardTitleBar';
export { buttonKind } from './ButtonKinds';
export { TintedActions } from './ButtonDensity';
export { useButtonKind } from './useButtonKind';
export {
    BoardCounter,
    CounterAge,
    CounterDash,
    CounterWords,
    QuietGlyph,
    CounterFigure,
    CounterItem,
    CounterList,
    CounterPartial,
} from './Counters';
export { noteBoardPlaces } from './BoardLife';
export { bringDeskIntoView, DeskCard, DeskHint, DeskSection } from './Desk';
export { BoardCard } from './BoardCard';
export { FilterBar, FilterChip, FilterChoice, FilterChoices, FilterMenu } from './Filters';
export { ListButton, ListGroupItem, ListHeader, ListItemRow, ListResults, ListRowGrid } from './List';
export { LoadingScreen } from './LoadingScreen';
export { RetryAction } from './RetryAction';
export { LabelPickerPopover } from './LabelPickerPopover';
export { OverflowCount } from './OverflowCount';
export { QuietLabel } from './QuietLabel';
export { ReleaseNotes, UpdatePill } from './UpdatePill';
export { BoardWarning, BoardWarnings, ToolMissing } from './Warnings';
export { ActivityLine, AgentAge, AgentList, AgentRow, WorkingAgents } from './ActivityLine';
export { ActivityTrack } from './ActivityTrack';
export { AttentionEntry, BoardAttentionList, AttentionMark, EntryButton, PartLink } from './Attention';
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
export { ItemFields, ItemTitle, RepoIdentity } from './ItemParts';
export { NeedsYouNotice, NeedsYouResult } from './NeedsYou';
export { PartKindIcon, PartsFrame, ShowDoneToggle } from './PartsList';
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
export { BuildLimit, ReadyBuildControls, HeaderSwitch, StageList, StagePane, StageSections } from './StagePane';
export {
    QueueAge,
    QueuePlace,
    RowBlocked,
    RowCells,
    RowCount,
    RowFirst,
    RowFoot,
    RowGlyph,
    RowIdentity,
    RowOpen,
    RowMeta,
    RowProgress,
    RowMetaEnd,
    RowSide,
    RowSliceNote,
    RowSliceToggle,
    RowSlices,
    RowState,
    RowTitle,
    RowTitleCell,
    StageRowItem,
    UsageFigures,
} from './StageRow';
export { ActionError, StartGroup, StartHold, StartLine, StartNote, StartTag } from './StartControls';
export { boardColor, statusColor } from './StatusColors';
export { StatusGlyph, StatusGlyphSlot } from './StatusGlyph';
export { EarlierThread, EarlierThreadList } from './Threads';
export {
    HistoryRow,
    MAP_NODE_HEIGHT,
    MAP_NODE_WIDTH,
    MapBand,
    MapCanvas,
    MapCheckNode,
    MapEdgeLabel,
    MapEdges,
    MapHistoryGroup,
    MapHistoryList,
    MapLaneName,
    MapNode,
    MapPrerequisiteNode,
    WorkMapFrame,
} from './WorkMap';
export {
    AccessNotice,
    DialogActions,
    ItemDialogAside,
    ItemDialogBody,
    ItemDialogColumns,
    ItemSummary,
    AsideFigures,
    FigureRows,
    ItemMainColumn,
    SummaryBlocked,
    SummaryPanel,
    SummaryParent,
    SummaryStatus,
    WarningNote,
} from './ItemDialog';
export {
    AddDescription,
    AttachmentLink,
    ChangeFailed,
    CheckRun,
    ChipGroup,
    DetailFact,
    DetailsLoading,
    DetailsSection,
    EditActions,
    EditorSlot,
    FactList,
    FocusPanel,
    HeaderStatus,
    InlineList,
    KindQuestion,
    MainSection,
    MetaArea,
    OutgoingTicket,
    SectionHeader,
    SpecSync,
    SprintCount,
    TextSection,
    TicketLink,
    TicketLinkList,
    TicketLinkPlaceholders,
    WaitsOnList,
} from './ItemDetails';
export {
    ItemProgressPanel,
    PartsProgress,
    ProgressActivity,
    ProgressCount,
    StageTrack,
    SliceChips,
    WorkflowSteps,
} from './ItemProgress';
export { ProjectIcon, type ProjectIconSize, type ProjectIconSource } from './ProjectIcon';
export { OpenSettingsButton, SettingsRowOpen } from './Settings';
export { CreateLabelForm, TrackerLabelEditor, TrackerLabelList, TrackerLabelRow } from './TrackerLabels';
export { VocabularyRow, VocabularySuggestion } from './Vocabulary';
export {
    AddFolderLine,
    ChoiceDetails,
    EmptyBoard,
    ProjectLine,
    ProjectList,
    ProjectListItem,
    SetupCardList,
    SetupHeader,
    SetupPane,
    SetupStep,
} from './Onboarding';
export { conceptIcons } from './ConceptIcons';
export { KindBadge, KindMark } from './KindBadge';

export { DossierParentContext, DossierStates } from './DossierContext';
export {
    FactorySettingsLayout,
    FactorySettingsGroup,
    FactoryChoice,
    FactoryText,
    FactoryAction,
    FactoryActions,
} from './FactorySettings';
export { VerifyResult, VerifyEvidence } from './VerifyResult';
export { SavedRunSection } from './SavedRunSection';
export {
    FactoryReviewerMode,
    FactoryCellChoice,
    FactoryModelTable,
    FactoryModelRow,
    FactoryReviewerRow,
} from './FactorySettingsLists';

export { ConceptBuildRun } from './ConceptBuildRun';
export { ReleaseProgress } from './ReleaseProgress';

export { RetroChoices } from './RetroChoices';

export { ReleaseStepForm } from './ReleaseStepForm';
export { GroupUpkeep } from './GroupUpkeep';

export { MapStack, MapStackItem } from './CompactWorkMap';
export { workHoldReason } from './work-hold-reason';

export { OneLineAction, StartAfterButton } from './StartAfterButton';
export { BriefChanges } from './BriefChanges';
export { BriefApprovalDetails } from './BriefApprovalDetails';

export { OutcomeForm, OutcomeFix } from './OutcomeForm';
export { BriefDependencyStatus } from './BriefDependencyStatus';

export { DeskDependencyProof } from './DeskDependencyProof';
export { TrackerLink } from './TrackerLink';
export { CardChecks, ChecksBar, type CardCheckState } from './Checks';
export { HeaderEmpty, LoadFailed, NoMatches } from './States';
export { MetaLine, Moment } from './TextParts';
