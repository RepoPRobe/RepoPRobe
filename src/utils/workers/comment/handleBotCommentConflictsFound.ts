import { Types } from "mongoose";
import { Conflict, ConflictType } from "../../../db/schema/Conflict.js";
import { QUEUE_EVENTS } from "../../../types/queue-events.js";
import { BotCommentConflictsFound } from "../../../types/queue-payloads.js";
import { postComment } from "../../common/comment.js";
import { PullRequest } from "../../../db/schema/PullRequest.js";
import { getConflictDetectionMarkdown } from "../../helpers/index.js";

export async function handleBotCommentConflictsFound(payload: BotCommentConflictsFound) {
    try {
        const prRecord = await PullRequest.findOne({
            _id: new Types.ObjectId(payload.prId),
            processingStatus: 'completed',
            conflictState: 'conflicts_found',
        });

        if (!prRecord) {
            console.log(`No PR record found for installation PR ${payload.prId}`);
            return;
        }
        const conflictsData: ConflictType[] = await Conflict.find({ prAId: prRecord._id });

        if (conflictsData.length === 0) {
            console.log(`No conflicts found for PR ${payload.prId}, skipping bot comment`);
            return;
        }

        await postComment(
            payload.installationId,
            payload.repoName,
            payload.repoOwnerLogin,
            prRecord.prNumber,
            await getConflictDetectionMarkdown(conflictsData),
        );
    } catch (error) {
        console.log(`Error ${QUEUE_EVENTS.BOT_COMMENT.CONFLICTS_FOUND}:`, error);
    }
}