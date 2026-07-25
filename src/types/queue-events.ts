export const QUEUE_EVENTS = {
    INSTALLATION: {
        CREATED: 'installation.created',
        DELETED: 'installation.deleted',
        SUSPEND: 'installation.suspend',
        UNSUSPEND: 'installation.unsuspend',
    },
    INSTALLATION_REPOSITORIES: {
        ADDED: 'installation_repositories.added',
        REMOVED: 'installation_repositories.removed',
    },
    PULL_REQUEST: {
        OPENED: 'pull_request.opened',
        CLOSED: 'pull_request.closed',
        REOPENED: 'pull_request.reopened',
        SYNCHRONIZE: 'pull_request.synchronize',
        EDITED: 'pull_request.edited',
        CONVERTED_TO_DRAFT: 'pull_request.converted_to_draft',
        READY_FOR_REVIEW: 'pull_request.ready_for_review',
        LABELED: 'pull_request.labeled',
        UNLABELED: 'pull_request.unlabeled',
        ASSIGNED: 'pull_request.assigned',
        UNASSIGNED: 'pull_request.unassigned',
    },
    COMMENT: {
        HELP: 'comment.help',
        STATUS: 'comment.status',
        CHECK: 'comment.check',
        TRACK: 'comment.track',
        UNTRACK: 'comment.untrack',
        INVALID_COMMAND: 'comment.invalid_command',
    },
    BOT_COMMENT: {
        CONFLICTS_FOUND: 'bot_comment.conflicts_found',
        CUSTOM: 'comment.custom',
    },
    CONFLICT_DETECTION: {
        SCAN_PR: 'conflict_detection.scan_pr',
    },
};
