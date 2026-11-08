// The names, icons and hues the board gives each visible item kind.

import type { Kind } from '@lar-factory/shared';
import { Bug, Lightbulb, Sparkles, TrendingUp, type LucideIcon } from '@lar-works/design-system/icons';

export const KIND_BADGES: Partial<Record<Kind, { name: string; icon: LucideIcon; hue: number }>> = {
    bug: { name: 'Bug', icon: Bug, hue: 25 },
    feature: { name: 'Feature', icon: Sparkles, hue: 150 },
    improvement: { name: 'Improvement', icon: TrendingUp, hue: 245 },
    concept: { name: 'Concept', icon: Lightbulb, hue: 300 },
};
