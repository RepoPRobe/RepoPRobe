import { model, Schema, Types } from 'mongoose';

interface ActivityLog {
    _id: Types.ObjectId,
    installationId: Types.ObjectId;
    repoId?: Types.ObjectId;
    pullRequestId?: Types.ObjectId;
    parentLogId?: Types.ObjectId;
    event: string;
    status: 'info' | 'success' | 'warning' | 'error';
    message: string;
    metadata?: Record<string, any>;
    createdAt: Date;
    updatedAt: Date;
}

const activityLogSchema = new Schema<ActivityLog>({
    installationId: { type: Types.ObjectId, ref: 'GithubInstallation', required: true },
    repoId: { type: Types.ObjectId, ref: 'Repo' },
    pullRequestId: { type: Types.ObjectId, ref: 'PullRequest' },
    parentLogId: { type: Types.ObjectId, ref: 'ActivityLog' },
    event: { type: String, required: true },
    status: {
        type: String,
        enum: ['info', 'success', 'warning', 'error'],
        required: true,
    },
    message: { type: String, required: true },
    metadata: {
        type: Schema.Types.Mixed,
        default: undefined,
    }
}, { timestamps: true });

export const ActivityLog = model<ActivityLog>('ActivityLog', activityLogSchema);
