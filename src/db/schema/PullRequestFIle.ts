import { Schema, model } from "mongoose";

const Line = {
    type: {
        type: String,
        enum: ['context', 'added', 'removed'],
        required: true,
    },
    oldFileLineNumber: Number, // null for 'added'
    newFileLineNumber: Number, // null for 'removed'
    content: {
        type: String,
        required: true,
    },
};

const Hunk = {
    oldFileStartLine: { type: Number, required: true },
    oldFilePatchLinesCount: { type: Number, required: true },
    newFileStartLine: { type: Number, required: true },
    newFilePatchLinesCount: { type: Number, required: true },
    lines: { type: [Line], required: true },
};

const pullRequestFileSchema = new Schema({
    pullRequestId: { type: Schema.Types.ObjectId, ref: 'PullRequest', required: true },
    file: { type: String, required: true },
    status: {
        type: String,
        enum: ["added", "removed", "modified", "renamed", "copied", "changed", "unchanged"],
        required: true,
    },
    hunks: { type: [Hunk], default: [] },
}, { timestamps: true });

export const PullRequestFile = model("PullRequestFile", pullRequestFileSchema);
