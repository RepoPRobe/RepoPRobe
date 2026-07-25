import { QUEUE_EVENTS } from "../../../types/queue-events";
import { BotCommentCustom } from "../../../types/queue-payloads";
import { postComment } from "../../common/comment";

export default async function handleBotCommentCustom(data: BotCommentCustom) {
    try {
        await postComment(
            data.installationId,
            data.repoName,
            data.repoOwnerLogin,
            data.prNumber,
            data.commentBody,
        );
    } catch (error) {
        console.log(`Error ${QUEUE_EVENTS.BOT_COMMENT.CUSTOM}:`, error);
    }
}