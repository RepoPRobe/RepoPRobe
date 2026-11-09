import { Worker } from "bullmq";
import { redisConnection } from "../utils/queue/connection.js";
import { QUEUE_EVENTS } from "../types/queue-events.js";
import { handleConflictDetectionScanPR } from "../utils/workers/conflict-detection/handleConflictDetectionScanPR.js";

export const conflictDetectionWorker = new Worker('conflict-detection', async (payload) => {
    console.log(`Processing conflict detection ${payload.name}`, payload.id);

    switch (payload.name) {
        case QUEUE_EVENTS.CONFLICT_DETECTION.SCAN_PR:
            await handleConflictDetectionScanPR(payload.data);
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

conflictDetectionWorker.on('completed', (payload) => {
    console.log(`Conflict Detection ${payload.id} completed`)
})

conflictDetectionWorker.on('failed', (payload, error) => {
    console.log(`Conflict Detection ${payload?.id} failed:`, error)
})
