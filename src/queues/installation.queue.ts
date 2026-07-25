import { Queue } from "bullmq";
import { redisConnection } from "../utils/queue/connection";

export const installationQueue = new Queue('installation', {
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
