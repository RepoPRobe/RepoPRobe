import { Queue } from "bullmq";
import { redisConnection } from "../utils/queue/connection";

export const pullRequestQueue = new Queue('pull-request', {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 2,
        backoff: {
            type: 'exponential',
            delay: 5000,
        },
        removeOnComplete: true,
        removeOnFail: true,
    },
});
