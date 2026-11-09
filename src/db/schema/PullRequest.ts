import { Schema, model, Types } from 'mongoose';
import { UserSchema, UserType } from '../common/index.js';

export interface PullRequestLabelType {
    id: number;
    name: string;
    default: boolean;
}

export interface PullRequestType {
    _id: Types.ObjectId;
    repoId: Types.ObjectId;
    installationId: Types.ObjectId;
    githubPrId: string;
    prNumber: number;
    title: string;
    htmlUrl: string;
    state: 'open' | 'closed' | 'merged';
    isDraft: boolean;
    baseBranch: string;
    baseBranchHeadSha: string;
    headBranch: string;
    headBranchHeadSha: string;
    author: UserType;
    labels: PullRequestLabelType[];
    githubCreatedAt: Date;
    githubUpdatedAt: Date;
    githubClosedAt?: Date | null;
    githubMergedAt?: Date | null;
    assignees: UserType[];
    lastCommitAt?: Date | null;
    isTracked: boolean;
    processingStatus: 'pending' | 'processing' | 'completed' | 'error';
    conflictState: 'no_conflicts' | 'conflicts_found' | 'unknown';
    deletedAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

const pullRequestSchema = new Schema<PullRequestType>({
    /**
     * PR related fields
     */
    repoId: { type: Types.ObjectId, ref: 'Repo', required: true },
    installationId: { type: Types.ObjectId, ref: 'GithubInstallation', required: true },
    githubPrId: { type: String, required: true },
    prNumber: { type: Number, required: true },
    title: { type: String, required: true },
    htmlUrl: { type: String, required: true },
    state: { type: String, enum: ['open', 'closed', 'merged'], required: true },
    isDraft: { type: Boolean, required: true },
    baseBranch: { type: String, required: true },
    baseBranchHeadSha: { type: String, required: true },
    headBranch: { type: String, required: true },
    headBranchHeadSha: { type: String, required: true },
    author: { type: UserSchema, required: true },
    labels: {
        type: [{
            id: { type: Number, required: true },
            name: { type: String, required: true },
            default: { type: Boolean, required: true },
        }], default: []
    },
    githubCreatedAt: { type: Date, required: true },
    githubUpdatedAt: { type: Date, required: true },
    githubClosedAt: { type: Date, default: null },
    githubMergedAt: { type: Date, default: null },
    assignees: { type: [UserSchema], default: [] },

    /**
     * System/processing related fields
     */
    lastCommitAt: { type: Date, default: null },
    isTracked: { type: Boolean, required: true, },
    processingStatus: {
        type: String,
        enum: ['pending', 'processing', 'completed', 'error'],
        default: 'pending',
        required: true,
    },
    conflictState: {
        type: String,
        enum: ['no_conflicts', 'conflicts_found', 'unknown'],
        default: 'unknown'
    },
    deletedAt: { type: Date, default: null },
}, { timestamps: true });

pullRequestSchema.index({ repoId: 1, githubPrId: 1 }, { unique: true });

export const PullRequest = model<PullRequestType>('PullRequest', pullRequestSchema);
