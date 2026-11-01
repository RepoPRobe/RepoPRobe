import { Types } from 'mongoose';
import { ActivityLog } from '../../db/schema/ActivityLogs';

type ActivityStatus = 'info' | 'success' | 'warning' | 'error';

export type LogActivityInput = {
    installationId: Types.ObjectId | string;
    repoId?: Types.ObjectId | string | null;
    pullRequestId?: Types.ObjectId | string | null;
    parentLogId?: Types.ObjectId;
    event: string;
    status: ActivityStatus;
    message: string;
    metadata?: Record<string, any>;
};

const toObjectId = (id: Types.ObjectId | string | null | undefined) => {
    if (!id) return undefined;
    return id instanceof Types.ObjectId ? id : new Types.ObjectId(id);
};

export async function logActivity(input: LogActivityInput) {
    try {
        const installationId = toObjectId(input.installationId);
        if (!installationId) return;

        const log = await ActivityLog.create({
            installationId,
            repoId: toObjectId(input.repoId),
            pullRequestId: toObjectId(input.pullRequestId),
            parentLogId: toObjectId(input.parentLogId),
            event: input.event,
            status: input.status,
            message: input.message,
            metadata: input.metadata,
        });
        return log._id;
    } catch (error) {
        console.log('Error writing activity log:', error, 'Input:', input);
    }
}
