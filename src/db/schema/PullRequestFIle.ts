import { Schema, model, Types } from 'mongoose';

export interface LineType {
    type: 'context' | 'added' | 'removed';
    oldFileLineNumber?: number | null;
    newFileLineNumber?: number | null;
    content: string;
}

export interface HunkType {
    oldFileStartLine: number;
    oldFilePatchLinesCount: number;
    newFileStartLine: number;
    newFilePatchLinesCount: number;
    lines: LineType[];
}

export interface PullRequestFileType {
    _id: Types.ObjectId;
    pullRequestId: Types.ObjectId;
    file: string;
    previousFilePath?: string | null;
    status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';
    hunks: HunkType[];
    createdAt: Date;
    updatedAt: Date;
}

const Line = new Schema<LineType>({
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
}, { _id: false });

export const Hunk = new Schema<HunkType>({
    oldFileStartLine: { type: Number, required: true },
    oldFilePatchLinesCount: { type: Number, required: true },
    newFileStartLine: { type: Number, required: true },
    newFilePatchLinesCount: { type: Number, required: true },
    lines: { type: [Line], required: true },
}, { _id: false });

const pullRequestFileSchema = new Schema<PullRequestFileType>({
    pullRequestId: { type: Schema.Types.ObjectId, ref: 'PullRequest', required: true },
    file: { type: String, required: true },
    previousFilePath: { type: String, default: null }, // available when status is 'renamed'
    status: {
        type: String,
        enum: ['added', 'removed', 'modified', 'renamed', 'copied', 'changed', 'unchanged'],
        required: true,
    },
    hunks: { type: [Hunk], default: [] },
}, { timestamps: true });

export const PullRequestFile = model<PullRequestFileType>('PullRequestFile', pullRequestFileSchema);
