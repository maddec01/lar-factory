// The Work map's stacking, bottom to top, in one place: what sits over the cards as the map scrolls sideways.

export const MAP_LAYER = {
    /** An edge's label ("before 1 completed part"), over the cards' rails. */
    edgeLabel: 'z-[4]',
    /** The lane names, opaque, so cards scrolled under them never show through. */
    laneNames: 'z-[5]',
    /** The fades at the map's edges, over the lane names' edge. */
    fade: 'z-10',
    /** The finished history's toggle, sticky on the lane names' edge, over the fades. */
    history: 'z-[11]',
    /** The pager pills, over everything. */
    pager: 'z-20',
} as const;
