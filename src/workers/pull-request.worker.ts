import { Worker } from "bullmq";
import { redisConnection } from "../utils/queue/connection.js";
import { QUEUE_EVENTS } from "../types/queue-events.js";
import { handlePullRequestOpened } from "../utils/workers/pr/handlePullRequestOpened.js";
import { handlePullRequestClosed } from "../utils/workers/pr/handlePullRequestClosed.js";
import { handlePullRequestReopened } from "../utils/workers/pr/handlePullRequestReopened.js";
import { handlePullRequestEdited } from "../utils/workers/pr/handlePullRequestEdited.js";
import { handlePullRequestConvertedToDraft } from "../utils/workers/pr/handlePullRequestConvertedToDraft.js";
import { handlePullRequestReadyForReview } from "../utils/workers/pr/handlePullRequestReadyForReview.js";
import { handlePullRequestLabeled } from "../utils/workers/pr/handlePullRequestLabeled.js";
import { handlePullRequestUnlabeled } from "../utils/workers/pr/handlePullRequestUnlabeled.js";
import { handlePullRequestAssigned } from "../utils/workers/pr/handlePullRequestAssigned.js";
import { handlePullRequestUnassigned } from "../utils/workers/pr/handlePullRequestUnassigned.js";
import { handlePullRequestSynchronize } from "../utils/workers/pr/handlePullRequestSynchronize.js";

export const pullRequestWorker = new Worker('pull-request', async (prPayload) => {
    console.log(`Processing job ${prPayload.name}`, prPayload.id);

    const data = prPayload.data;

    switch (prPayload.name) {
        case QUEUE_EVENTS.PULL_REQUEST.OPENED:
            await handlePullRequestOpened(data);
            break;
        case QUEUE_EVENTS.PULL_REQUEST.CLOSED:
            await handlePullRequestClosed(data);
            break;
        case QUEUE_EVENTS.PULL_REQUEST.REOPENED:
            await handlePullRequestReopened(data);
            break;
        case QUEUE_EVENTS.PULL_REQUEST.EDITED:
            await handlePullRequestEdited(data);
            break;
        case QUEUE_EVENTS.PULL_REQUEST.CONVERTED_TO_DRAFT:
            await handlePullRequestConvertedToDraft(data);
            break;
        case QUEUE_EVENTS.PULL_REQUEST.READY_FOR_REVIEW:
            await handlePullRequestReadyForReview(data);
            break;
        case QUEUE_EVENTS.PULL_REQUEST.LABELED:
            await handlePullRequestLabeled(data);
            break;
        case QUEUE_EVENTS.PULL_REQUEST.UNLABELED:
            await handlePullRequestUnlabeled(data);
            break;
        case QUEUE_EVENTS.PULL_REQUEST.ASSIGNED:
            await handlePullRequestAssigned(data);
            break;
        case QUEUE_EVENTS.PULL_REQUEST.UNASSIGNED:
            await handlePullRequestUnassigned(data);
            break;
        case QUEUE_EVENTS.PULL_REQUEST.SYNCHRONIZE:
            await handlePullRequestSynchronize(data);
            break;
        default:
            break;
    }
}, {
    connection: redisConnection,
    concurrency: 1,
    autorun: false,
    lockDuration: 60_000,
})

pullRequestWorker.on('completed', (prPayload) => {
    console.log(`Pull Request ${prPayload.id} completed`)
})

pullRequestWorker.on('failed', (prPayload, error) => {
    console.log(`Pull Request ${prPayload?.id} failed:`, error)
})
