import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import express from 'express';
import { installationQueue } from "./queues/installation.queue.js";
import { pullRequestQueue } from "./queues/pull-request.queue.js";
import { commentQueue } from "./queues/comment.queue.js";
import { conflictDetectionQueue } from "./queues/conflict-detection.queue.js";

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

const { addQueue, removeQueue, setQueues, replaceQueues } = createBullBoard({
    queues: [
        new BullMQAdapter(installationQueue),
        new BullMQAdapter(pullRequestQueue),
        new BullMQAdapter(commentQueue),
        new BullMQAdapter(conflictDetectionQueue),
    ],
    serverAdapter: serverAdapter,
});

export { serverAdapter }
