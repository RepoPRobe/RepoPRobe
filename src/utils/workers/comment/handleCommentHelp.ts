import { QUEUE_EVENTS } from "../../../types/queue-events.js";
import { CommentHelp, CommentInvalidCommand } from "../../../types/queue-payloads.js";
import { postComment } from "../../common/comment.js";

const HELP_COMMENT = `
### RepoPRobe commands

- \`@RepoPRobe check\` — scan this PR for conflicts
- \`@RepoPRobe status\` — view tracking, scan, and processing status
- \`@RepoPRobe track\`, \`@RepoPRobe untrack\` — enable or disable tracking
- \`@RepoPRobe reprocess\` — refresh the PR files and scan again
- \`@RepoPRobe help\` — show this command list

Reactions: 👀 received · 👍 completed · 😕 couldn't complete
`;

const INVALID_COMMENT = `
### Unknown command
> _Use \`@RepoPRobe help\` to see the available commands._
`;

export async function handleCommentHelp(payload: CommentHelp) {
    try {
        await postComment(
            Number(payload.installationId),
            payload.repoName,
            payload.repoOwnerLogin,
            payload.prNumber,
            HELP_COMMENT
        );
        console.log(`Posted help comment for PR ${payload.prNumber} in repo ${payload.repoOwnerLogin}/${payload.repoName}`);
    } catch (error) {
        console.log(`Error ${QUEUE_EVENTS.COMMENT.HELP}:`, error);
    }
}

export async function handleCommentInvalidCommand(payload: CommentInvalidCommand) {
    try {
        await postComment(
            Number(payload.installationId),
            payload.repoName,
            payload.repoOwnerLogin,
            payload.prNumber,
            INVALID_COMMENT,
        );
        console.log(`Posted invalid command comment for PR ${payload.prNumber} in repo ${payload.repoOwnerLogin}/${payload.repoName}`);
    } catch (error) {
        console.log(`Error ${QUEUE_EVENTS.COMMENT.INVALID_COMMAND}:`, error);
    }
}