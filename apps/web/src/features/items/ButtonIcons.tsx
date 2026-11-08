// The icons the board's button kinds carry: Start's play, an Open's thread or pull request, and the ticket's tracker.

import { AzureDevOpsIcon, GitHubIcon, GitPullRequest, MessageSquareText, Play } from '@lar-works/design-system/icons';

export const ICON = {
    play: <Play />,
    thread: <MessageSquareText />,
    pr: <GitPullRequest />,
    github: <GitHubIcon />,
    azure: <AzureDevOpsIcon />,
};
