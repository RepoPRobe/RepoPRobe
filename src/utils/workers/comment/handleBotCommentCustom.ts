import { QUEUE_EVENTS } from "../../../types/queue-events.js";
import { BotCommentCustom } from "../../../types/queue-payloads.js";
import { postComment } from "../../common/comment.js";

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