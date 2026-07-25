import { QUEUE_EVENTS } from "../../../types/queue-events";
import { CommentHelp, CommentInvalidCommand } from "../../../types/queue-payloads";
import { postComment } from "../../common/comment";

const HELP_COMMENT = `
## 📋 RepoProbe Commands

| Command | Description |
|---------|-------------|
| \`@RepoPRobe check\` | Re-run conflict detection on this PR |
| \`@RepoPRobe status\` | Show current PR info, tracking state, conflict status, last checked |
| \`@RepoPRobe track\` | Enable conflict tracking for this PR |
| \`@RepoPRobe untrack\` | Disable conflict tracking for this PR |
| \`@RepoPRobe help\` | Show this commands list |

### Reactions

| Reaction | Meaning | Supported Commands/Comments |
|---|---|---|
| 👀 | Command received, will be acknowledged soon | \`all\` |
| 👍 | Command processed successfully | \`track\`, \`untrack\`, \`check\` |
| 😕 | Unable to process your command (duplicate operation, something went wrong, or processing failed) | \`all\` |
`;

const INVALID_COMMENT = `
> [!NOTE]
> The command you entered is not recognized. Below is the list of supported commands.

${HELP_COMMENT}
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
        postComment(
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