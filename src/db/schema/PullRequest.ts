import { Schema, model, Types } from "mongoose";
import { UserSchema } from "../common";

const pullRequestSchema = new Schema({
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
    conflictCommentId: { type: String, default: null },
    lastCommitAt: { type: Date, default: null },
    isTracked: { type: Boolean, required: true, },
    areFilesProcessed: { type: Boolean, default: false }, // will be picked by the worker/processor
    deletedAt: { type: Date, default: null },
}, { timestamps: true })

pullRequestSchema.index({ repoId: 1, githubPrId: 1 }, { unique: true })

export const PullRequest = model('PullRequest', pullRequestSchema)
