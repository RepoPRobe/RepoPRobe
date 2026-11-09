import { Worker } from 'bullmq';
import { redisConnection } from '../utils/queue/connection.js';
import { QUEUE_EVENTS } from '../types/queue-events.js';
import { handleCommentHelp, handleCommentInvalidCommand } from '../utils/workers/comment/handleCommentHelp.js';
import { handleCommentTrack } from '../utils/workers/comment/handleCommentTrack.js';
import { handleCommentUntrack } from '../utils/workers/comment/handleCommentUntrack.js';
import { handleCommentCheck } from '../utils/workers/comment/handleCommentCheck.js';
import { handleBotCommentConflictsFound } from '../utils/workers/comment/handleBotCommentConflictsFound.js';
import handleBotCommentCustom from '../utils/workers/comment/handleBotCommentCustom.js';
import { handleCommentStatus } from '../utils/workers/comment/handleCommentStatus.js';

export const commentWorker = new Worker('comment', async (commentPayload) => {
    console.log(`Processing comment ${commentPayload.name}`, commentPayload.id);

    const data = commentPayload.data;

    switch (commentPayload.name) {
        case QUEUE_EVENTS.COMMENT.TRACK:
            await handleCommentTrack(data);
            break;
        case QUEUE_EVENTS.COMMENT.UNTRACK:
            await handleCommentUntrack(data);
            break;
        case QUEUE_EVENTS.COMMENT.HELP:
            await handleCommentHelp(data);
            break;
        case QUEUE_EVENTS.COMMENT.CHECK:
            await handleCommentCheck(data);
            break;
        case QUEUE_EVENTS.BOT_COMMENT.CONFLICTS_FOUND:
            await handleBotCommentConflictsFound(data);
            break;
        case QUEUE_EVENTS.BOT_COMMENT.CUSTOM:
            await handleBotCommentCustom(data);
            break;
        case QUEUE_EVENTS.COMMENT.STATUS:
            await handleCommentStatus(data);
            break;
        default:  // QUEUE_EVENTS.COMMENT.INVALID_COMMAND
            await handleCommentInvalidCommand(data);
            break;
    }
}, {
    connection: redisConnection,
    concurrency: 1,
    autorun: false,
    lockDuration: 60_000,
})

commentWorker.on('completed', (commentPayload) => {
    console.log(`Comment ${commentPayload.id} completed`)
})

commentWorker.on('failed', (commentPayload, error) => {
    console.log(`Comment ${commentPayload?.id} failed:`, error)
})
