// The item's activity track, named by its current feedback and sweeping while that feedback says it is running.

import { buildActivity } from '@lar-factory/shared';

import { ActivityTrack } from '@/ui/board';

export function ActivityFeedback({ feedback }: { feedback: ReturnType<typeof buildActivity> }) {
    return <ActivityTrack label={feedback.label} running={feedback.running} />;
}
