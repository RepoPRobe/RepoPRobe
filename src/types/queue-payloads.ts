type GithubUser = {
    id: string;
    login: string;
    avatarUrl: string;
    githubUrl: string;
    userType: string;
};

export type InstallationCreated = {
    installationId: string;
    owner: GithubUser | null;
    installedBy: GithubUser;
    installationHtmlUrl: string;
    installationTargetId: string;
    installationAccountType: string;
    installationInstalledOn: string;
    installationUpdatedAt: string;
    installationRepositorySelection: 'all' | 'selected';
    repositories: {
        id: string;
        name: string;
        full_name: string;
    }[];
}

export type InstallationDeleted = {
    installationId: string;
}

export type InstallationSuspend = {
    installationId: string;
}

export type InstallationUnsuspend = {
    installationId: string;
}

export type InstallationRepositoriesAdded = {
    installationId: string;
    installationRepositorySelection: 'all' | 'selected';
    repositoriesAdded: {
        id: string;
        name: string;
        full_name: string;
    }[];
}

export type InstallationRepositoriesRemoved = {
    installationId: string;
    repositoriesRemoved: {
        id: string;
    }[];
}

export type PullRequestOpened = {
    installationId: string;
    repositoryId: string;
    repoName: string;
    repoOwnerLogin: string;
    prId: string;
    prNumber: number;
    prTitle: string;
    prHtmlUrl: string;
    prState: 'open' | 'closed' | 'merged';
    isDraft: boolean | undefined;
    baseBranchRef: string;
    baseBranchHeadSha: string;
    headBranchRef: string;
    headBranchHeadSha: string;
    author: GithubUser;
    prLabels: {
        id: string;
        name: string;
        default: boolean;
    }[];
    prCreatedOn: string;
    prUpdatedAt: string;
    source: 'webhook' | 'dashboard' | 'comment';
}

export type PullRequestClosed = {
    installationId: string;
    prState: 'closed' | 'merged';
    mergedAt?: string | null;
    prId: string;
    updatedAt: string;
}

export type PullRequestReopened = {
    installationId: string;
    prId: string;
    prState: string;
    updatedAt: string;
}

export type PullRequestEdited = {
    installationId: string;
    prId: string;
    repoName: string;
    repoOwnerLogin: string;
    updatedTitle?: string;
    updatedBase?: string;
    updatedBaseSha?: string;
    updatedAt: string;
}

export type PullRequestConvertedToDraft = {
    installationId: string;
    prId: string;
    updatedAt: string;
}

export type PullRequestReadyForReview = {
    installationId: string;
    prId: string;
    updatedAt: string;
}

export type PullRequestLabeled = {
    installationId: string;
    prId: string;
    updatedAt: string;
    label: {
        id: string;
        name: string;
        default: boolean;
    };
}

export type PullRequestUnlabeled = {
    installationId: string;
    prId: string;
    updatedAt: string;
    label: {
        id: string;
        name: string;
        default: boolean;
    };
}

export type PullRequestAssigned = {
    installationId: string;
    prId: string;
    updatedAt: string;
    assignee: {
        id: string;
        login: string;
        avatarUrl: string;
        githubUrl: string;
        userType: string;
    };
}

export type PullRequestUnassigned = {
    installationId: string;
    prId: string;
    updatedAt: string;
    assignee: {
        id: string;
        login: string;
        avatarUrl: string;
        githubUrl: string;
        userType: string;
    };
}

export type PullRequestSynchronize = {
    installationId: string;
    prId: string;
    updatedAt: string;
    repoOwnerLogin: string;
    repoName: string;
    prNumber: number;
    beforeCommitSha: string;
    afterCommitSha: string;
}

export type CommentHelp = {
    prNumber: number;
    repoOwnerLogin: string;
    repoName: string;
    installationId: string;
}

export type CommentInvalidCommand = {
    prNumber: number;
    repoOwnerLogin: string;
    repoName: string;
    installationId: string;
}

export type CommentTrack = {
    prNumber: number;
    repoOwnerLogin: string;
    repoName: string;
    repoId: string;
    installationId: string;
    githubCommentId?: number;
    source: 'comment' | 'dashboard';
}

export type CommentUntrack = {
    prNumber: number;
    repoOwnerLogin: string;
    repoName: string;
    repoId: string;
    installationId: string;
    githubCommentId?: number;
    source: 'comment' | 'dashboard';
}

export type CommentCheck = {
    prNumber: number;
    repoOwnerLogin: string;
    repoName: string;
    repoId: string;
    installationId: string;
    githubCommentId: number;
}

export type CommentStatus = {
    prNumber: number;
    repoOwnerLogin: string;
    repoName: string;
    repoId: string;
    installationId: string;
}

export type BotCommentConflictsFound = {
    installationId: number;
    repoName: string;
    repoOwnerLogin: string;
    prId: string;
}

export type BotCommentCustom = {
    installationId: number;
    repoName: string;
    repoOwnerLogin: string;
    prNumber: number;
    commentBody: string;
}

export type ConflictDetectionScanPR = {
    installationId: number;
    repoName: string;
    repoOwnerLogin: string;
    prId: string;
    source: 'comment' | 'dashboard' | 'webhook';
}