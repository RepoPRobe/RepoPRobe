import { Queue } from "bullmq";
import { redisConnection } from "../utils/queue/connection.js";

export const conflictDetectionQueue = new Queue('conflict-detection', {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
    },
});
