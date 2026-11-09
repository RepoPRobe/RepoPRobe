import { Queue } from "bullmq";
import { redisConnection } from "../utils/queue/connection.js";

export const commentQueue = new Queue('comment', {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 5000,
        },
        removeOnComplete: true,
        removeOnFail: true,
    },
});