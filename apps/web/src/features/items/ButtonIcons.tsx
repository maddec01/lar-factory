// The icons the board's button kinds carry: Start's play, Queue's clock, an Open's thread or pull request, and the ticket's tracker.

import {
    AzureDevOpsIcon,
    Clock3,
    GitHubIcon,
    GitPullRequest,
    MessageSquareText,
    Play,
} from '@lar-works/design-system/icons';

export const ICON = {
    play: <Play />,
    queue: <Clock3 />,
    thread: <MessageSquareText />,
    pr: <GitPullRequest />,
    github: <GitHubIcon />,
    azure: <AzureDevOpsIcon />,
};
