// The names, icons and hues the board gives each visible item kind: each hue is the design system's categorical
// palette's, never a status's.

import type { Kind } from '@lar-factory/shared';
import { categoricalHues } from '@lar-works/design-system';
import { Bug, Lightbulb, Sparkles, TrendingUp, type LucideIcon } from '@lar-works/design-system/icons';

export const KIND_BADGES: Partial<Record<Kind, { name: string; icon: LucideIcon; hue: number }>> = {
    bug: { name: 'Bug', icon: Bug, hue: categoricalHues.rose },
    feature: { name: 'Feature', icon: Sparkles, hue: categoricalHues.lime },
    improvement: { name: 'Improvement', icon: TrendingUp, hue: categoricalHues.cyan },
    concept: { name: 'Concept', icon: Lightbulb, hue: categoricalHues.violet },
};
